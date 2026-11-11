'use strict';

// Local MCP Tracker tools, ported from close-ai src/mcp/__tests__/tracker-tools.test.ts
// at 6cd11dfb (PR #3603; trackly-app/close-ai#3600, Lane 2).
//
// The tools proxy the existing Waypoint routes with the user's own credentials,
// so these tests drive the real local MCP server, through lib/client.js over
// HTTP, against a fake of /api/jobscout/waypoint/applications whose stage and
// event effectiveness come from the ported reducer. They assert the exact HTTP
// sequence: jobId resolution, expectedVersion handoff, retry-once on 409,
// deterministic idempotency keys, the note follow-up, and that nothing is
// written on error.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { configureMcpAnalytics, shutdownMcpAnalytics } = require('../mcp/analytics');
const { WAYPOINT_STAGES, fromZonedTime, reduceStage } = require('../mcp/waypoint-reducer');
const { createTempConfigDir, startMockServer, withEnv } = require('./helpers');

const TRACKER_TOOLS = [
  'trackly_list_tracker_applications',
  'trackly_create_tracker_application',
  'trackly_update_tracker_stage',
  'trackly_add_tracker_note',
  'trackly_retract_tracker_event',
];
const PRIVATE_EMAIL = 'recruiter.private@example.com';
const BASE = '/api/jobscout/waypoint/applications';
const SOURCES = '/api/jobscout/waypoint/sources';
const HOSTED_FIXTURE = path.join(__dirname, 'fixtures', 'tracker', 'hosted-tracker-tools-8f7ba68e.json');

const laDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** An HTTP error the fake backend answers with: the status and the JSON body. */
function httpError(status, body) {
  return Object.assign(new Error(String(body.error)), { httpStatus: status, body });
}

function view(app) {
  return {
    id: app.id, companyId: 7, companyName: app.companyName, roleTitle: app.roleTitle, location: null, link: app.link,
    source: 'applied_confirmed', appliedAt: '2026-11-01T17:00:00.000Z', appliedAtEvidence: 'exact_submission',
    jobPostingId: app.jobPostingId, currentStage: app.currentStage, stageEnteredAt: app.stageEnteredAt, daysInStage: 3,
    nextEvent: null, lastCompanyContactAt: null, followUp: { sentCount: 0, lastSentAt: null, waitingUntil: null, doNotFollowUp: false, contactAvailable: false },
    version: app.version, mergedIntoId: app.mergedIntoId, interviews: [], deadlines: [], effectiveEventIds: [],
  };
}

/** The stored row for a fake event, in the shape the reducer reads (local dates stored as midnight in LA). */
function rowOf(e) {
  return {
    id: e.id, applicationId: e.applicationId, userId: 7, kind: e.kind, fromStage: e.fromStage,
    toStage: e.toStage, occurredAt: e.occurredAt ? fromZonedTime(`${e.occurredAt}T00:00:00`, 'America/Los_Angeles') : null,
    occurredPrecision: e.occurredAt ? 'local_date' : null, occurredTz: e.occurredAt ? 'America/Los_Angeles' : null,
    observedAt: e.observedAt, actor: 'user', status: 'confirmed', lineageClass: 'C', payload: e.payload,
    supersedesEventId: e.supersedesEventId, retractsEventId: e.retractsEventId, idempotencyKey: e.idempotencyKey, createdAt: e.observedAt,
  };
}

/**
 * A minimal Waypoint backend: the same status codes and bodies as the backend routes, with the
 * entry's stage and each event's effectiveness computed by the reducer, so ordering, drags,
 * retractions and edits behave as they do in production.
 */
function fakeTracker(opts = {}) {
  const enabled = opts.enabled ?? true;
  const apps = new Map((opts.apps ?? [
    { id: 11, jobPostingId: 652000911, companyName: 'Speak', roleTitle: 'Product Manager', link: 'https://example.com/speak', currentStage: 'applied', stageEnteredAt: '2026-11-01T17:00:00.000Z', version: 4, mergedIntoId: null },
    { id: 12, jobPostingId: 651997892, companyName: 'MaintainX', roleTitle: 'PM, Platform', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-02T17:00:00.000Z', version: 2, mergedIntoId: null },
  ]).map((a) => [a.id, { ...a }]));
  // Observation times advance 10 ms per event, starting an hour ago, so the reducer orders them as written. The start
  // never precedes today's midnight in Los Angeles, so an undated event written "today" counts for today even when the
  // suite runs shortly after midnight (close-ai's copy starts a full hour back and fails between 00:00 and 01:00 PT).
  let clock = Math.max(Date.now() - 3_600_000, fromZonedTime(`${laDate(new Date())}T00:00:00`, 'America/Los_Angeles').getTime());
  const tick = () => new Date((clock += 10));
  const seeded = new Date(Date.now() - 10 * 86_400_000);
  const events = [
    // Every real entry starts with a stage event (the applied backfill or Quick Add): no fromStage, so not a drag.
    { id: 498, applicationId: 11, kind: 'stage_change', fromStage: null, toStage: 'applied', occurredAt: null, payload: {}, idempotencyKey: 'board:498', observedAt: seeded, supersedesEventId: null, retractsEventId: null },
    { id: 499, applicationId: 12, kind: 'stage_change', fromStage: null, toStage: 'applied', occurredAt: null, payload: {}, idempotencyKey: 'board:499', observedAt: seeded, supersedesEventId: null, retractsEventId: null },
    // A board event that carries a contact email: no tool output may echo it.
    { id: 500, applicationId: 11, kind: 'company_contact', fromStage: null, toStage: null, occurredAt: '2026-11-03', payload: { contactType: 'reply', contactEmail: PRIVATE_EMAIL, contactName: 'Pat Recruiter', futureField: 'not yet public', label: { email: PRIVATE_EMAIL } }, idempotencyKey: 'board:500', observedAt: seeded, supersedesEventId: null, retractsEventId: null },
  ];
  let nextAppId = 70;
  const calls = [];
  let conflicts = opts.conflicts ?? 0;
  let nextEventId = 900;

  // Like loadApplicationSets: an entry's set includes the events of entries merged into it.
  const own = (appId) => events.filter((e) => e.applicationId === appId || apps.get(e.applicationId)?.mergedIntoId === appId);
  const reduced = (appId, extra = []) => reduceStage([...own(appId), ...extra].map(rowOf));
  const effective = (e) => reduced(e.applicationId).effectiveEventIds.includes(e.id);
  /** After a write: the route re-reduces the set and bumps the version. */
  const settle = (app) => {
    const stage = reduced(app.id).currentStage;
    if (stage) app.currentStage = stage;
    app.version += 1;
  };
  // Like the route: the database stamps a new event after every row it already holds.
  const push = (e) => {
    const latest = Math.max(...events.map((x) => x.observedAt.getTime()));
    const stamped = tick();
    const event = { ...e, id: nextEventId++, observedAt: stamped.getTime() > latest ? stamped : new Date(latest + 1) };
    events.push(event);
    return event;
  };
  const eventView = (e) => ({
    ...e, observedAt: e.observedAt.toISOString(), createdAt: e.observedAt.toISOString(),
    occurredPrecision: e.occurredAt ? 'local_date' : null, occurredTz: e.occurredAt ? 'America/Los_Angeles' : null,
    actor: 'user', status: 'confirmed', lineageClass: 'C', effective: effective(e),
  });

  async function requestApi(method, requestPath, body) {
    calls.push({ method, path: requestPath, ...(body === undefined ? {} : { body: structuredClone(body) }) });
    if (!enabled) throw httpError(404, { error: 'not_found' });
    if (method === 'GET' && requestPath === SOURCES) {
      if (opts.probeError) throw httpError(opts.probeError, { error: 'internal_error' });
      return { sources: [] };
    }
    const url = new URL(requestPath, 'https://closeai.mba');
    if (method === 'GET' && url.pathname === BASE) {
      const stage = url.searchParams.get('stage');
      const q = url.searchParams.get('q')?.toLowerCase();
      const job = url.searchParams.get('jobPostingId');
      // Like the route: the roots holding the job, including the survivor a linked entry was merged into.
      const holding = job === null ? null : new Set([...apps.values()].filter((a) => a.jobPostingId === Number(job)).map((a) => a.mergedIntoId ?? a.id));
      const list = [...apps.values()].filter((a) => a.mergedIntoId === null)
        .filter((a) => holding === null || holding.has(a.id))
        .filter((a) => !stage || a.currentStage === stage)
        .filter((a) => !q || `${a.companyName} ${a.roleTitle}`.toLowerCase().includes(q));
      return { applications: list.slice(0, opts.listCap ?? list.length).map(view) };
    }
    const one = url.pathname.match(/^\/api\/jobscout\/waypoint\/applications\/(\d+)$/);
    if (method === 'GET' && one) {
      const app = apps.get(Number(one[1]));
      if (!app) throw httpError(404, { error: 'not_found' });
      const list = own(app.id).map(eventView);
      return { application: view(app), events: list, effectiveEventIds: list.filter((e) => e.effective).map((e) => e.id) };
    }
    const job = url.pathname.match(/^\/api\/jobscout\/jobs\/(\d+)$/);
    if (method === 'GET' && job) {
      const found = opts.jobs?.[Number(job[1])];
      if (!found) throw httpError(404, { success: false, error: 'Job not found' });
      return { success: true, job: found };
    }
    if (method === 'POST' && url.pathname === BASE) {
      const hit = events.find((e) => e.idempotencyKey === `create:${body.idempotencyKey}`);
      if (hit) return { application: view(apps.get(hit.applicationId)) };
      if (body.jobPostingId !== undefined && !opts.jobs?.[body.jobPostingId]) throw httpError(400, { error: 'invalid_request' });
      const app = { id: nextAppId++, jobPostingId: body.jobPostingId ?? null, companyName: body.companyName, roleTitle: body.roleTitle, link: body.link ?? null, currentStage: 'applied', stageEnteredAt: '2026-11-09T08:00:00.000Z', version: 0, mergedIntoId: null };
      apps.set(app.id, app);
      push({ applicationId: app.id, kind: 'stage_change', fromStage: null, toStage: 'applied', occurredAt: body.appliedAt ?? null, payload: {}, idempotencyKey: `create:${body.idempotencyKey}`, supersedesEventId: null, retractsEventId: null });
      settle(app);
      return { application: view(app) };
    }
    const retract = url.pathname.match(/^\/api\/jobscout\/waypoint\/applications\/(\d+)\/events\/(\d+)\/retract$/);
    if (method === 'POST' && retract) {
      const app = apps.get(Number(retract[1]));
      if (!app) throw httpError(404, { error: 'not_found' });
      const target = events.find((e) => e.id === Number(retract[2]) && e.applicationId === app.id);
      if (!target) throw httpError(404, { error: 'not_found' });
      if (events.some((e) => e.retractsEventId === target.id)) return { application: view(app) };
      if (opts.retractError) throw httpError(opts.retractError.status, opts.retractError.body);
      if (conflicts > 0) {
        conflicts -= 1;
        app.version += 1;
        throw httpError(409, { error: 'version_conflict', application: view(app) });
      }
      if (body.expectedVersion !== app.version) throw httpError(409, { error: 'version_conflict', application: view(app) });
      const row = { applicationId: app.id, kind: target.kind, fromStage: null, toStage: null, occurredAt: null, payload: {}, idempotencyKey: `retract:${target.id}`, supersedesEventId: null, retractsEventId: target.id };
      const would = reduced(app.id, [{ ...row, id: Number.MAX_SAFE_INTEGER, observedAt: new Date() }]).currentStage;
      if (reduced(app.id).currentStage !== null && would === null) throw httpError(400, { error: 'cannot_retract_only_stage', application: view(app) });
      push(row);
      settle(app);
      return { application: view(app) };
    }
    const post = url.pathname.match(/^\/api\/jobscout\/waypoint\/applications\/(\d+)\/events$/);
    if (method === 'POST' && post) {
      const app = apps.get(Number(post[1]));
      if (!app) throw httpError(404, { error: 'not_found' });
      if (app.mergedIntoId !== null) throw httpError(409, { error: 'merged', application: view(app) });
      const hit = events.find((e) => e.idempotencyKey === body.idempotencyKey);
      if (hit) {
        if (hit.kind !== body.kind || hit.toStage !== (body.toStage ?? null) || hit.occurredAt !== (body.occurredAt ?? null)
          || JSON.stringify(hit.payload) !== JSON.stringify(body.payload ?? {})) throw httpError(422, { error: 'idempotency_key_reused' });
        return { application: view(app), event: eventView(hit) };
      }
      if (conflicts > 0) {
        conflicts -= 1;
        opts.bumpOnConflict?.(app);
        app.version += 1;
        throw httpError(409, opts.conflictBody === false ? { error: 'version_conflict' } : { error: 'version_conflict', application: view(app) });
      }
      if (body.expectedVersion !== app.version) throw httpError(409, { error: 'version_conflict', application: view(app) });
      if (body.kind === 'note' && opts.failNote) throw httpError(500, { error: 'internal_error' });
      if (opts.postError) throw httpError(opts.postError.status, opts.postError.body);
      // Like the route: a new stage change records the stage it moves from, which makes it a deliberate user move.
      const event = push({
        applicationId: app.id, kind: body.kind, fromStage: body.toStage ? reduced(app.id).currentStage : null, toStage: body.toStage ?? null,
        occurredAt: body.occurredAt ?? null, payload: body.payload ?? {}, idempotencyKey: body.idempotencyKey, supersedesEventId: null, retractsEventId: null,
      });
      settle(app);
      return { application: view(app), event: eventView(event) };
    }
    throw new Error(`unexpected request ${method} ${requestPath}`);
  }
  const writes = () => calls.filter((c) => c.method !== 'GET');
  const newEvents = () => events.filter((e) => e.id >= 900 && e.retractsEventId === null && e.supersedesEventId === null);
  /** The user drags the card on the board (a later, deliberate move). */
  const drag = (appId, toStage, occurredAt = null) => {
    const app = apps.get(appId);
    push({ applicationId: appId, kind: 'stage_change', fromStage: reduced(appId).currentStage, toStage, occurredAt, payload: {}, idempotencyKey: null, supersedesEventId: null, retractsEventId: null });
    settle(app);
  };
  /** The user edits an event on the board (a correction that supersedes it). */
  const edit = (eventId, payload, observedAt) => {
    const target = events.find((e) => e.id === eventId);
    const event = push({ applicationId: target.applicationId, kind: target.kind, fromStage: null, toStage: target.toStage, occurredAt: target.occurredAt, payload, idempotencyKey: null, supersedesEventId: eventId, retractsEventId: null });
    if (observedAt) event.observedAt = observedAt;
    settle(apps.get(target.applicationId));
    return event;
  };
  /** A note the user typed on the board at a given time (undated, so it counts for the day it was observed). */
  const boardNote = (appId, text, observedAt) => {
    const event = push({ applicationId: appId, kind: 'note', fromStage: null, toStage: null, occurredAt: null, payload: { text }, idempotencyKey: null, supersedesEventId: null, retractsEventId: null });
    event.observedAt = observedAt;
    settle(apps.get(appId));
    return event;
  };
  /** The user merges one entry into another on the board. */
  const mergeInto = (sourceId, intoId) => {
    apps.get(sourceId).mergedIntoId = intoId;
    apps.get(sourceId).version += 1;
    settle(apps.get(intoId));
  };
  return { requestApi, calls, writes, events, newEvents, apps, drag, edit, mergeInto, boardNote };
}

const noBackend = () => fakeTracker();

/**
 * Serve a fake backend over HTTP and drive the real local MCP server against it through
 * lib/client.js. `backend` is a fake (its requestApi answers) or a function wrapping one.
 */
async function withClient(backend, run, { analytics = false } = {}) {
  const handle = typeof backend === 'function' ? backend : backend.requestApi;
  const unexpected = [];
  const configDir = createTempConfigDir();
  const { server: httpServer, port } = await startMockServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const send = (status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      try {
        const value = await handle(req.method, req.url, raw ? JSON.parse(raw) : undefined);
        if (value && typeof value.rawHtml === 'string') {
          // A proxy or captive-portal page: lib/client.js resolves a non-JSON 2xx as {raw, message}.
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end(value.rawHtml);
        }
        send(200, value);
      } catch (error) {
        if (error?.httpStatus) return send(error.httpStatus, error.body);
        unexpected.push(String(error?.message || error));
        return send(500, { error: 'unexpected_fake_request' });
      }
    });
  });
  try {
    await withEnv({
      TRACKLY_API_KEY: 'trk_test_tracker_tools',
      TRACKLY_CONFIG_DIR: configDir,
      TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    }, async () => {
      const server = createServer();
      if (analytics) {
        configureMcpAnalytics(server, {
          env: {},
          loadSdk: () => require('@posthog/mcp'),
          createRelay: () => ({ capture() {}, flush: async () => {}, _shutdown: async () => {} }),
        });
      }
      const client = new Client({ name: 'tracker-tools-test', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        await run(client);
      } finally {
        await client.close().catch(() => {});
        await server.close().catch(() => {});
        if (analytics) await shutdownMcpAnalytics(server).catch(() => {});
      }
    });
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    fs.rmSync(configDir, { recursive: true, force: true });
  }
  assert.deepEqual(unexpected, [], 'the fake backend received only requests it models');
}

function payloadOf(result) {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return { result, body: payloadOf(result), isError: result.isError === true };
}

async function callRaw(client, name, args) {
  return client.callTool({ name, arguments: args }).catch((e) => ({ isError: true, e }));
}

/** Partial deep match, like vitest toMatchObject. */
function assertMatch(actual, expected, where = 'value') {
  if (expected instanceof RegExp) return assert.match(actual, expected, where);
  if (expected === null || typeof expected !== 'object') return assert.deepEqual(actual, expected, where);
  assert.ok(actual && typeof actual === 'object', `${where} must be an object`);
  for (const [key, value] of Object.entries(expected)) assertMatch(actual[key], value, `${where}.${key}`);
}


test('Tracker tools: registration, schemas and hosted parity', async (t) => {
  await t.test('registers the five Tracker tools with the 12 Waypoint stages', async () => {
    await withClient(noBackend(), async (client) => {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of TRACKER_TOOLS) assert.ok(byName.has(name), name);
      const stageSchema = byName.get('trackly_update_tracker_stage').inputSchema.properties.stage;
      assert.deepEqual([...stageSchema.enum].sort(), [...WAYPOINT_STAGES].sort());
      assert.equal(stageSchema.enum.length, 12);
      const listStage = byName.get('trackly_list_tracker_applications').inputSchema.properties.stage;
      assert.deepEqual([...listStage.enum].sort(), [...WAYPOINT_STAGES].sort());
      assert.ok(!stageSchema.enum.includes('paused'));
      // A shared zod instance would render as a $ref, which some MCP clients and the catalog export reject.
      for (const name of TRACKER_TOOLS) assert.doesNotMatch(JSON.stringify(byName.get(name).inputSchema), /\$ref/);
      const update = byName.get('trackly_update_tracker_stage').inputSchema;
      assert.ok(update.properties.occurredOn.pattern);
      assert.equal(update.properties.note.maxLength, 1000);
      assert.deepEqual(update.required, ['stage']);
    });
  });

  await t.test('says the Tracker stage is separate from trackly_update_status and that pauses are notes', async () => {
    await withClient(noBackend(), async (client) => {
      const { tools } = await client.listTools();
      const stage = tools.find((tool) => tool.name === 'trackly_update_tracker_stage').description;
      assert.ok(stage.includes('trackly_update_status'));
      assert.match(stage, /keeps? (its|the) Applied record/i);
      assert.match(stage, /no "?paused"? stage/i);
      const note = tools.find((tool) => tool.name === 'trackly_add_tracker_note').description;
      assert.match(note, /pause/i);
    });
  });

  await t.test('tools/list matches the hosted MCP at close-ai 8f7ba68e exactly (names, descriptions, schemas, annotations)', async () => {
    const hosted = JSON.parse(fs.readFileSync(HOSTED_FIXTURE, 'utf8'));
    assert.deepEqual(hosted.map((tool) => tool.name), TRACKER_TOOLS);
    // The hosted server injects the analytics context property itself; locally analytics does it at startup.
    await withClient(noBackend(), async (client) => {
      const { tools } = await client.listTools();
      for (const expected of hosted) {
        const { scopes, ...descriptor } = expected;
        assert.deepEqual(scopes, [expected.name === 'trackly_list_tracker_applications' ? 'tracking:read' : 'tracking:write']);
        assert.deepEqual(JSON.parse(JSON.stringify(tools.find((tool) => tool.name === expected.name))), descriptor, expected.name);
      }
    }, { analytics: true });
  });
  await t.test('unknown arguments are rejected before any HTTP call with analytics enabled', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = {
        trackly_list_tracker_applications: {},
        trackly_create_tracker_application: { explicitUserConfirmed: true, jobId: 9 },
        trackly_update_tracker_stage: { applicationId: 11, stage: 'rejected' },
        trackly_add_tracker_note: { applicationId: 11, text: 'x' },
        trackly_retract_tracker_event: { applicationId: 11, eventId: 500 },
      };
      for (const name of TRACKER_TOOLS) {
        const result = await callRaw(client, name, { ...args[name], context: 'record an outcome', unsupportedFocus: 'x' });
        assert.equal(result.isError, true, name);
      }
      assert.equal(fake.calls.length, 0);
    }, { analytics: true });
  });
});

test('trackly_list_tracker_applications', async (t) => {
  await t.test('forwards stage and query and projects the compact view', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_list_tracker_applications', { stage: 'applied', query: 'speak' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls, [{ method: 'GET', path: `${BASE}?stage=applied&q=speak` }]);
      assert.deepEqual(body.applications, [{
        id: 11, jobPostingId: 652000911, company: 'Speak', role: 'Product Manager', currentStage: 'applied',
        stageEnteredAt: '2026-11-01T17:00:00.000Z', version: 4, link: 'https://example.com/speak',
      }]);
      assert.equal(body.count, 1);
    });
  });

  await t.test('filters by jobId through the route', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body } = await call(client, 'trackly_list_tracker_applications', { jobId: 651997892 });
      assert.deepEqual(fake.calls, [{ method: 'GET', path: `${BASE}?jobPostingId=651997892` }]);
      assert.deepEqual(body.applications.map((a) => a.id), [12]);
    });
  });

  await t.test('rejects an unknown stage and an over-long query before any HTTP call', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      assert.equal((await callRaw(client, 'trackly_list_tracker_applications', { stage: 'paused' })).isError, true);
      assert.equal((await callRaw(client, 'trackly_list_tracker_applications', { query: 'x'.repeat(101) })).isError, true);
      assert.equal(fake.calls.length, 0);
    });
  });

  await t.test('returns tracker_unavailable when the Waypoint gate is off', async () => {
    const fake = fakeTracker({ enabled: false });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_list_tracker_applications', {});
      assert.equal(isError, true);
      assert.equal(body.error, 'tracker_unavailable');
    });
  });

  await t.test('rejects an unreadable list response instead of passing it through', async () => {
    await withClient(async () => ({ applications: [{ id: 'x', email: PRIVATE_EMAIL }] }), async (client) => {
      const { body, isError } = await call(client, 'trackly_list_tracker_applications', {});
      assert.equal(isError, true);
      assert.equal(body.error, 'invalid_tracker_response');
      assert.doesNotMatch(JSON.stringify(body), /recruiter\.private/);
    });
  });

  await t.test('treats a non-JSON or array-less 2xx list page as unreadable, so create never writes a twin', async () => {
    for (const page of [{ rawHtml: '<html>Sign in to the network</html>' }, { ok: true }]) {
      const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
      const garbled = async (method, requestPath, body) => {
        if (method === 'GET' && (requestPath === BASE || requestPath.startsWith(`${BASE}?`))) {
          fake.calls.push({ method, path: requestPath });
          return page;
        }
        return fake.requestApi(method, requestPath, body);
      };
      await withClient(garbled, async (client) => {
        for (const args of [{ explicitUserConfirmed: true, jobId: 9 }, { explicitUserConfirmed: true, companyName: 'Clay', roleTitle: 'PM' }]) {
          const { body, isError } = await call(client, 'trackly_create_tracker_application', args);
          assert.equal(isError, true);
          assert.equal(body.error, 'invalid_tracker_response');
        }
        const listed = await call(client, 'trackly_list_tracker_applications', {});
        assert.equal(listed.body.error, 'invalid_tracker_response');
        const moved = await call(client, 'trackly_update_tracker_stage', { jobId: 9, stage: 'rejected' });
        assert.equal(moved.body.error, 'invalid_tracker_response');
        assert.deepEqual(fake.writes(), []);
      });
    }
  });
});

test('trackly_update_tracker_stage', async (t) => {
  await t.test('resolves jobId, hands off the read version and writes one stage_change event', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { jobId: 652000911, stage: 'rejected', occurredOn: '2026-11-09' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [
        `GET ${BASE}?jobPostingId=652000911`,
        `GET ${BASE}/11`,
        `POST ${BASE}/11/events`,
      ]);
      assert.deepEqual(fake.writes()[0].body, {
        kind: 'stage_change', toStage: 'rejected', expectedVersion: 4,
        occurredAt: '2026-11-09', occurredPrecision: 'local_date', occurredTz: 'America/Los_Angeles',
        payload: {}, idempotencyKey: 'mcp:stage:11:v4:rejected:2026-11-09',
      });
      assertMatch(body.application, { id: 11, company: 'Speak', currentStage: 'rejected', version: 5 });
      assert.equal(body.stageEventId, 900);
      assert.equal(body.changed, true);
    });
  });

  await t.test('accepts applicationId directly', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 12, stage: 'interview' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [`GET ${BASE}/12`, `POST ${BASE}/12/events`]);
      const post = fake.writes()[0].body;
      assert.equal(post.occurredAt, undefined);
      assert.equal(post.occurredPrecision, undefined);
      assert.match(post.idempotencyKey, /^mcp:stage:12:v2:interview:observed-\d{4}-\d{2}-\d{2}$/);
      assert.equal(post.idempotencyKey, `mcp:stage:12:v2:interview:observed-${laDate(new Date())}`);
    });
  });

  await t.test('adds the note as a second event on the new version', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', {
        jobId: 652000911, stage: 'rejected', occurredOn: '2026-11-09', note: 'rejection email, Nov 9',
      });
      assert.equal(isError, false);
      const [stage, note] = fake.writes();
      assert.equal(stage.body.kind, 'stage_change');
      assert.equal(note.path, `${BASE}/11/events`);
      assertMatch(note.body, {
        kind: 'note', expectedVersion: 5, payload: { text: 'rejection email, Nov 9' },
        occurredAt: '2026-11-09', occurredPrecision: 'local_date', occurredTz: 'America/Los_Angeles',
      });
      assert.match(note.body.idempotencyKey, /^mcp:note:11:[0-9a-f]{16}:2026-11-09$/);
      assert.equal(body.noteEventId, 901);
      assert.equal(body.noteSaved, true);
      assert.equal(body.application.version, 6);
    });
  });

  await t.test('rejects a stage outside the 12 Waypoint stages before any HTTP call', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      assert.equal((await callRaw(client, 'trackly_update_tracker_stage', { jobId: 652000911, stage: 'paused' })).isError, true);
      assert.equal(fake.calls.length, 0);
    });
  });

  for (const args of [
    { stage: 'rejected' },
    { stage: 'rejected', jobId: 652000911, applicationId: 11 },
    { stage: 'rejected', jobId: 652000911, occurredOn: '2026-02-30' },
    { stage: 'rejected', jobId: 652000911, occurredOn: '11/09/2026' },
    { stage: 'rejected', jobId: 652000911, note: 'x'.repeat(1001) },
    { stage: 'rejected', jobId: 652000911, note: '' },
    { stage: 'rejected', jobId: 652000911, note: '   ' },
    { stage: 'rejected', jobId: 3_000_000_000 },
    { stage: 'rejected', jobId: 652000911, unexpected: true },
  ]) {
    await t.test(`rejects invalid input ${JSON.stringify(args).slice(0, 80)} without any HTTP call`, async () => {
      const fake = fakeTracker();
      await withClient(fake, async (client) => {
        assert.equal((await callRaw(client, 'trackly_update_tracker_stage', args)).isError, true);
        assert.equal(fake.calls.length, 0);
      });
    });
  }

  await t.test('returns not_found for a job with no Tracker entry and writes nothing', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { jobId: 999, stage: 'rejected' });
      assert.equal(isError, true);
      assert.equal(body.error, 'not_found');
      assert.match(body.hint, /no Tracker entry yet/);
      assert.ok(body.hint.includes('trackly_create_tracker_application'));
      // The stage tool never creates an entry itself.
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('returns not_found for an unknown applicationId while the Tracker is on', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 404, stage: 'rejected' });
      assert.equal(isError, true);
      assert.equal(body.error, 'not_found');
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('passes on a failed probe instead of reporting not_found', async () => {
    const fake = fakeTracker({ probeError: 500 });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 404, stage: 'rejected' });
      assert.equal(isError, true);
      assert.notEqual(body.error, 'not_found');
      assert.notEqual(body.error, 'tracker_unavailable');
      assert.equal(body.status, 500);
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('returns tracker_unavailable when the gate is off and writes nothing', async () => {
    for (const args of [{ jobId: 652000911, stage: 'rejected' }, { applicationId: 11, stage: 'rejected' }]) {
      const fake = fakeTracker({ enabled: false });
      await withClient(fake, async (client) => {
        const { body, isError } = await call(client, 'trackly_update_tracker_stage', args);
        assert.equal(isError, true);
        assert.equal(body.error, 'tracker_unavailable');
        assert.deepEqual(fake.writes(), []);
      });
    }
  });

  await t.test('refuses an ambiguous jobId that matches two Tracker entries', async () => {
    const fake = fakeTracker({ apps: [
      { id: 21, jobPostingId: 5, companyName: 'Clay', roleTitle: 'PM', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 1, mergedIntoId: null },
      { id: 22, jobPostingId: 5, companyName: 'Clay', roleTitle: 'PM', link: null, currentStage: 'saved', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 1, mergedIntoId: null },
    ] });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { jobId: 5, stage: 'rejected' });
      assert.equal(isError, true);
      assert.equal(body.error, 'ambiguous_job');
      assert.deepEqual(body.candidates.map((c) => c.id).sort(), [21, 22]);
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('does not write when the entry is already in the requested stage', async () => {
    const fake = fakeTracker();
    fake.apps.get(11).currentStage = 'rejected';
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assert.equal(isError, false);
      assert.equal(body.changed, false);
      assert.equal(body.stageEventId, null);
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('retries once on 409 version_conflict with the version from the 409 body, without a second read', async () => {
    const fake = fakeTracker({ conflicts: 1 });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [
        `GET ${BASE}/11`, `POST ${BASE}/11/events`, `POST ${BASE}/11/events`,
      ]);
      const [first, second] = fake.writes();
      assert.equal(first.body.expectedVersion, 4);
      assert.equal(second.body.expectedVersion, 5);
      assert.equal(second.body.idempotencyKey, first.body.idempotencyKey);
      assert.equal(body.application.currentStage, 'rejected');
    });
  });

  await t.test('re-reads once when a 409 body carries no entry', async () => {
    const fake = fakeTracker({ conflicts: 1, conflictBody: false });
    await withClient(fake, async (client) => {
      const { isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [
        `GET ${BASE}/11`, `POST ${BASE}/11/events`, `GET ${BASE}/11`, `POST ${BASE}/11/events`,
      ]);
      assert.deepEqual(fake.writes().map((w) => w.body.expectedVersion), [4, 5]);
    });
  });

  await t.test('returns the conflict with version, stage and merge target after a second 409', async () => {
    const fake = fakeTracker({ conflicts: 2 });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assert.equal(isError, true);
      assert.equal(body.error, 'version_conflict');
      assertMatch(body, { version: 6, currentStage: 'applied', mergedIntoId: null });
      assertMatch(body.application, { id: 11, version: 6 });
      assert.equal(fake.writes().length, 2);
      assert.deepEqual(fake.newEvents(), []);
    });
  });

  await t.test('returns the conflict without retrying when the re-read already shows the requested stage', async () => {
    const fake = fakeTracker({ conflicts: 1, bumpOnConflict: (app) => { app.currentStage = 'rejected'; } });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', note: 'should not be written' });
      assert.equal(isError, true);
      assert.equal(body.error, 'version_conflict');
      assert.equal(body.currentStage, 'rejected');
      assert.equal(fake.writes().length, 1);
      assert.deepEqual(fake.newEvents(), []);
    });
  });

  await t.test('writes nothing on a repeat after success, and replays a concurrent duplicate instead of writing twice', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { applicationId: 11, stage: 'rejected', occurredOn: '2026-11-09', note: 'rejection email, Nov 9' };
      await call(client, 'trackly_update_tracker_stage', args);
      const again = await call(client, 'trackly_update_tracker_stage', args);
      assertMatch(again.body, { changed: false, reason: 'already_in_stage', noteSaved: true });
      // The note replays under its deterministic key instead of adding a copy.
      assert.deepEqual(fake.newEvents().map((e) => e.kind), ['stage_change', 'note']);
    });
    const racing = fakeTracker();
    await withClient(racing, async (client) => {
      const args = { applicationId: 11, stage: 'interview', occurredOn: '2026-11-09' };
      // Both calls read version 4 before either writes, so they send the same key and the second replays.
      const [a, b] = await Promise.all([call(client, 'trackly_update_tracker_stage', args), call(client, 'trackly_update_tracker_stage', args)]);
      assert.deepEqual([a.isError, b.isError], [false, false]);
      const keys = racing.writes().map((w) => w.body.idempotencyKey);
      assert.equal(new Set(keys).size, 1);
      assert.equal(racing.newEvents().length, 1);
    });
  });

  await t.test('records a same-day redo after the stage event was retracted', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { applicationId: 11, stage: 'rejected' };
      const first = await call(client, 'trackly_update_tracker_stage', args);
      await call(client, 'trackly_retract_tracker_event', { applicationId: 11, eventId: first.body.stageEventId });
      assert.equal(fake.apps.get(11).currentStage, 'applied');
      const redo = await call(client, 'trackly_update_tracker_stage', args);
      assertMatch(redo.body, { changed: true, application: { currentStage: 'rejected' } });
      assert.notEqual(redo.body.stageEventId, first.body.stageEventId);
      const stageKeys = fake.writes().filter((w) => w.body.kind === 'stage_change').map((w) => w.body.idempotencyKey);
      assert.notEqual(stageKeys[1], stageKeys[0]);
    });
  });

  await t.test('records an undated redo after the card was dragged back on the board', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { applicationId: 11, stage: 'rejected' };
      await call(client, 'trackly_update_tracker_stage', args);
      fake.drag(11, 'applied');
      assert.equal(fake.apps.get(11).currentStage, 'applied');
      const redo = await call(client, 'trackly_update_tracker_stage', args);
      assertMatch(redo.body, { changed: true, application: { currentStage: 'rejected' } });
      assert.equal(fake.newEvents().filter((e) => e.toStage === 'rejected').length, 2);
    });
  });

  await t.test('does not add another copy of a dated stage event that a later stage change outranks', async () => {
    const fake = fakeTracker();
    fake.drag(11, 'interview', '2026-11-05');
    await withClient(fake, async (client) => {
      const args = { applicationId: 11, stage: 'rejected', occurredOn: '2026-10-01', note: 'rejection email, Oct 1' };
      const first = await call(client, 'trackly_update_tracker_stage', args);
      assertMatch(first.body, { changed: false, reason: 'later_stage_event', stageEventId: 901, application: { currentStage: 'interview' } });
      const again = await call(client, 'trackly_update_tracker_stage', args);
      assertMatch(again.body, { changed: false, reason: 'already_recorded', stageEventId: 901, noteSaved: true });
      assert.match(again.body.hint, /already on this entry/);
      assert.deepEqual(fake.newEvents().map((e) => e.kind), ['stage_change', 'stage_change', 'note']);
    });
  });

  await t.test('says why when a recorded stage does not become current (a later-dated stage event)', async () => {
    const fake = fakeTracker();
    fake.drag(11, 'interview', '2026-11-05');
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', occurredOn: '2026-10-01' });
      assert.equal(isError, false);
      assertMatch(body, { changed: false, reason: 'later_stage_event', stageEventId: 901, application: { currentStage: 'interview' } });
      assert.match(body.hint, /a later date/);
    });
  });

  await t.test('writes a same-day correction that would become current', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', occurredOn: '2026-11-09' });
      fake.drag(11, 'interview', '2026-11-09');
      const redo = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', occurredOn: '2026-11-09' });
      assertMatch(redo.body, { changed: true, application: { currentStage: 'rejected' } });
    });
  });

  await t.test('does not repeat an undated stage call that an event dated today outranks', async () => {
    const today = laDate(new Date());
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'interview', occurredOn: today });
      const first = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assertMatch(first.body, { changed: false, reason: 'later_stage_event', application: { currentStage: 'interview' } });
      const again = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assertMatch(again.body, { changed: false, reason: 'already_recorded', stageEventId: first.body.stageEventId });
      assert.equal(fake.newEvents().filter((e) => e.toStage === 'rejected').length, 1);
    });
  });

  await t.test('writes a wanted move even when this machine\'s clock lags the backend', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      // The user drags the card back; the backend stamps it 5 minutes ahead of this machine's clock.
      fake.drag(11, 'interview');
      fake.events[fake.events.length - 1].observedAt = new Date(Date.now() + 5 * 60_000);
      const redo = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
      assert.equal(redo.isError, false);
      assertMatch(redo.body, { changed: true, application: { currentStage: 'rejected' } });
      assert.equal(fake.writes().filter((w) => w.body.kind === 'stage_change').length, 2);
    });
  });

  await t.test('adds only the note when the entry is already in the stage', async () => {
    const fake = fakeTracker();
    fake.apps.get(11).currentStage = 'rejected';
    await withClient(fake, async (client) => {
      const { body } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', note: 'confirmed by phone' });
      assertMatch(body, { changed: false, reason: 'already_in_stage', stageEventId: null, noteSaved: true });
      assert.deepEqual(fake.writes().map((w) => w.body.kind), ['note']);
    });
  });

  for (const [postError, expected] of [
    [{ status: 422, body: { error: 'idempotency_key_reused' } }, 'idempotency_key_reused'],
    [{ status: 400, body: { error: 'invalid_request' } }, 'invalid_request'],
    [{ status: 409, body: { error: 'merged', application: view({ id: 11, jobPostingId: 652000911, companyName: 'Speak', roleTitle: 'Product Manager', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-01T17:00:00.000Z', version: 4, mergedIntoId: 13 }) } }, 'merged'],
  ]) {
    await t.test(`maps a ${postError.status} ${postError.body.error} write error to ${expected} without writing`, async () => {
      const fake = fakeTracker({ postError });
      await withClient(fake, async (client) => {
        const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected' });
        assert.equal(isError, true);
        assert.equal(body.error, expected);
        if (expected === 'merged') assert.equal(body.mergedIntoId, 13);
        assert.deepEqual(fake.newEvents(), []);
      });
    });
  }

  await t.test('reports a merged entry without retrying', async () => {
    const fake = fakeTracker({ apps: [
      { id: 31, jobPostingId: null, companyName: 'Ashby', roleTitle: 'PM', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 3, mergedIntoId: 32 },
    ] });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 31, stage: 'rejected' });
      assert.equal(isError, true);
      assert.equal(body.error, 'merged');
      assertMatch(body, { mergedIntoId: 32, version: 3, currentStage: 'applied' });
      assert.deepEqual(fake.newEvents(), []);
    });
  });

  await t.test('reports the committed stage change as success with noteSaved false when only the note fails', async () => {
    const fake = fakeTracker({ failNote: true });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', note: 'rejection email' });
      assert.equal(isError, false);
      assertMatch(body, { changed: true, stageEventId: 900, noteEventId: null, noteSaved: false, noteError: 'internal_error' });
      assert.equal(body.application.currentStage, 'rejected');
      assert.match(body.noteHint, /trackly_add_tracker_note/);
    });
  });

  await t.test('returns an error when the note fails and no stage change was committed', async () => {
    const fake = fakeTracker({ failNote: true });
    fake.apps.get(11).currentStage = 'rejected';
    await withClient(fake, async (client) => {
      const { isError } = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', note: 'rejection email' });
      assert.equal(isError, true);
      assert.deepEqual(fake.newEvents(), []);
    });
  });
});

test('trackly_add_tracker_note', async (t) => {
  await t.test('writes one note event with the read version and a deterministic key', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { jobId: 651997892, text: 'employer paused hiring Nov 9', occurredOn: '2026-11-09' };
      const { body, isError } = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [`GET ${BASE}?jobPostingId=651997892`, `GET ${BASE}/12`, `POST ${BASE}/12/events`]);
      const sent = fake.writes()[0].body;
      assert.match(sent.idempotencyKey, /^mcp:note:12:[0-9a-f]{16}:2026-11-09$/);
      // FIRST16HEX(sha256(text)), as the hosted key is built.
      const digest = require('node:crypto').createHash('sha256').update('employer paused hiring Nov 9').digest('hex').slice(0, 16);
      assert.deepEqual(sent, {
        kind: 'note', expectedVersion: 2, payload: { text: 'employer paused hiring Nov 9' },
        occurredAt: '2026-11-09', occurredPrecision: 'local_date', occurredTz: 'America/Los_Angeles',
        idempotencyKey: `mcp:note:12:${digest}:2026-11-09`,
      });
      assert.equal(body.noteEventId, 900);
      assertMatch(body.application, { id: 12, currentStage: 'applied', version: 3 });
      await call(client, 'trackly_add_tracker_note', args);
      assert.equal(fake.newEvents().length, 1);
    });
  });

  await t.test('re-adds a note the user retracted earlier the same day, once', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { applicationId: 12, text: 'employer paused hiring', occurredOn: '2026-11-09' };
      const first = await call(client, 'trackly_add_tracker_note', args);
      await call(client, 'trackly_retract_tracker_event', { applicationId: 12, eventId: first.body.noteEventId });
      const redo = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(redo.isError, false);
      assert.notEqual(redo.body.noteEventId, first.body.noteEventId);
      assert.equal(redo.body.noteSaved, true);
      const again = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(again.body.noteEventId, redo.body.noteEventId);
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note').length, 2);
      // A second undo and re-add follows the chain of retracted copies and still lands once.
      await call(client, 'trackly_retract_tracker_event', { applicationId: 12, eventId: redo.body.noteEventId });
      const third = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(third.isError, false);
      assert.notEqual(third.body.noteEventId, redo.body.noteEventId);
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note').length, 3);
      const fourth = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(fourth.body.noteEventId, third.body.noteEventId);
      const keys = fake.writes().filter((w) => w.body.kind === 'note').map((w) => w.body.idempotencyKey);
      assert.ok(keys.some((k) => /:after-\d+$/.test(k)));
    });
  });

  await t.test('does not bring back a note the user edited on the board', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const args = { applicationId: 12, text: 'recruiter call Tuesday', occurredOn: '2026-11-09' };
      const first = await call(client, 'trackly_add_tracker_note', args);
      fake.edit(first.body.noteEventId, { text: 'recruiter call Wednesday' });
      const again = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(again.isError, false);
      assertMatch(again.body, { noteSaved: false, reason: 'note_edited_since', noteEventId: first.body.noteEventId });
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note' && e.payload.text === 'recruiter call Tuesday').length, 1);
      const viaStage = await call(client, 'trackly_update_tracker_stage', { applicationId: 12, stage: 'applied', note: 'recruiter call Tuesday', occurredOn: '2026-11-09' });
      assertMatch(viaStage.body, { noteSaved: false, noteError: 'note_edited_since' });
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note' && e.payload.text === 'recruiter call Tuesday').length, 1);
    });
  });

  await t.test('does not add a note again after its entry was merged into another', async () => {
    const fake = fakeTracker({ apps: [
      { id: 12, jobPostingId: 651997892, companyName: 'MaintainX', roleTitle: 'PM, Platform', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-02T17:00:00.000Z', version: 2, mergedIntoId: null },
      { id: 40, jobPostingId: null, companyName: 'MaintainX', roleTitle: 'Product Manager', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-02T17:00:00.000Z', version: 1, mergedIntoId: null },
    ] });
    await withClient(fake, async (client) => {
      const args = { jobId: 651997892, text: 'employer paused hiring', occurredOn: '2026-11-09' };
      const first = await call(client, 'trackly_add_tracker_note', args);
      fake.mergeInto(12, 40);
      const again = await call(client, 'trackly_add_tracker_note', args);
      assert.equal(again.isError, false);
      assertMatch(again.body, { noteEventId: first.body.noteEventId, noteSaved: true, application: { id: 40 } });
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note').length, 1);
    });
  });

  await t.test('counts an edited undated note for the day of the note it corrects', async () => {
    const fake = fakeTracker();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const original = fake.boardNote(12, 'recruiter replied', twoDaysAgo);
    fake.edit(original.id, { text: 'recruiter replied, call Tuesday' }, new Date(Date.now() - 60_000));
    await withClient(fake, async (client) => {
      // The correction counts for the original day, so the same text for today is a new note...
      const today = await call(client, 'trackly_add_tracker_note', { applicationId: 12, text: 'recruiter replied, call Tuesday', occurredOn: laDate(new Date()) });
      assertMatch(today.body, { noteSaved: true });
      assert.ok(today.body.noteEventId > original.id + 1);
      // ...and for the original day the correction is already there, so nothing is added.
      const before = await call(client, 'trackly_add_tracker_note', { applicationId: 12, text: 'recruiter replied, call Tuesday', occurredOn: laDate(twoDaysAgo) });
      assertMatch(before.body, { noteSaved: true, noteEventId: original.id + 1 });
      const written = fake.newEvents().filter((e) => e.kind === 'note' && e.payload.text === 'recruiter replied, call Tuesday');
      assert.equal(written.length, 1);
    });
  });

  await t.test('does not repeat a note the user already added on the board the same day', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      await call(client, 'trackly_add_tracker_note', { applicationId: 12, text: 'offer call Friday', occurredOn: '2026-11-09' });
      const viaStage = await call(client, 'trackly_update_tracker_stage', { applicationId: 12, stage: 'interview', occurredOn: '2026-11-09', note: 'offer call Friday' });
      assertMatch(viaStage.body, { changed: true, noteSaved: true });
      assert.equal(fake.newEvents().filter((e) => e.kind === 'note').length, 1);
    });
  });

  await t.test('reuses a same-day copy a concurrent call added under another key instead of retrying into a twin', async () => {
    const text = 'recruiter call moved';
    // The concurrent call wrote the same text for today (for example dated today, so under another key) between
    // this call's read and its write; this call's POST then meets a version conflict.
    let fake;
    fake = fakeTracker({ conflicts: 1, bumpOnConflict: () => fake.boardNote(12, text, new Date()) });
    await withClient(fake, async (client) => {
      const { isError, body } = await call(client, 'trackly_add_tracker_note', { applicationId: 12, text });
      assert.equal(isError, false);
      assertMatch(body, { noteSaved: true });
      assert.equal(fake.events.filter((e) => e.kind === 'note' && e.payload.text === text).length, 1);
      assert.equal(fake.writes().length, 1);
    });
  });

  await t.test('retries once on 409 and leaves the stage alone', async () => {
    const fake = fakeTracker({ conflicts: 1 });
    await withClient(fake, async (client) => {
      const { isError, body } = await call(client, 'trackly_add_tracker_note', { applicationId: 12, text: 'recruiter call moved' });
      assert.equal(isError, false);
      assert.deepEqual(fake.writes().map((w) => w.body.expectedVersion), [2, 3]);
      assert.equal(body.application.currentStage, 'applied');
      assert.ok(fake.writes().every((w) => w.body.kind === 'note'));
    });
  });

  for (const args of [
    { text: 'x' },
    { jobId: 1, applicationId: 2, text: 'x' },
    { jobId: 1, text: '' },
    { jobId: 1, text: 'x'.repeat(1001) },
  ]) {
    await t.test(`rejects invalid input ${JSON.stringify(args).slice(0, 80)} without any HTTP call`, async () => {
      const fake = fakeTracker();
      await withClient(fake, async (client) => {
        assert.equal((await callRaw(client, 'trackly_add_tracker_note', args)).isError, true);
        assert.equal(fake.calls.length, 0);
      });
    });
  }

  await t.test('returns not_found and tracker_unavailable without writing', async () => {
    const off = fakeTracker({ enabled: false });
    await withClient(off, async (client) => {
      const { body } = await call(client, 'trackly_add_tracker_note', { jobId: 652000911, text: 'x' });
      assert.equal(body.error, 'tracker_unavailable');
      assert.deepEqual(off.writes(), []);
    });
    const on = fakeTracker();
    await withClient(on, async (client) => {
      const { body } = await call(client, 'trackly_add_tracker_note', { jobId: 1, text: 'x' });
      assert.equal(body.error, 'not_found');
      assert.deepEqual(on.writes(), []);
    });
  });
});

test('trackly_create_tracker_application', async (t) => {
  const JOBS = {
    652276591: { id: 652276591, companyName: 'Gradient Labs', title: 'Product Manager', location: 'London, UK', jobUrl: 'https://jobs.example.com/gradient/pm' },
  };

  await t.test('resolves company, role, location and link from the Trackly job and sends a deterministic key', async () => {
    const fake = fakeTracker({ jobs: JOBS });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652276591, appliedOn: '2026-11-04' });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls.map((c) => `${c.method} ${c.path}`), [
        `GET ${BASE}?jobPostingId=652276591`, 'GET /api/jobscout/jobs/652276591', `GET ${BASE}?q=gradient`, `POST ${BASE}`,
        // One more look for a twin a concurrent create may have added.
        `GET ${BASE}?jobPostingId=652276591`, `GET ${BASE}?q=gradient`,
      ]);
      assert.ok(!Object.hasOwn(body, 'possibleDuplicates'));
      assert.deepEqual(fake.writes()[0].body, {
        companyName: 'Gradient Labs', roleTitle: 'Product Manager', jobPostingId: 652276591, location: 'London, UK',
        link: 'https://jobs.example.com/gradient/pm', appliedAt: '2026-11-04', appliedAtPrecision: 'local_date',
        appliedAtTz: 'America/Los_Angeles', idempotencyKey: 'mcp:job:652276591',
      });
      assertMatch(body, { created: true, application: { jobPostingId: 652276591, company: 'Gradient Labs', currentStage: 'applied', version: 1 } });
      const tool = (await client.listTools()).tools.find((value) => value.name === 'trackly_create_tracker_application');
      assert.match(tool.description, /records the job as applied/);
      assert.deepEqual(tool.inputSchema.required, ['explicitUserConfirmed']);
    });
  });

  await t.test('creates from companyName and roleTitle with a key that ignores case and spacing', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Ashby', roleTitle: 'Product  Manager', link: 'https://ashby.example.com/pm' });
      assert.equal(body.created, true);
      // The name check searches by the longest word of the normalized company name.
      assert.deepEqual(fake.calls[0], { method: 'GET', path: `${BASE}?q=ashby` });
      const first = fake.writes()[0].body;
      assert.ok(!Object.hasOwn(first, 'jobPostingId'));
      assert.ok(!Object.hasOwn(first, 'appliedAt'));
      assert.match(first.idempotencyKey, /^mcp:name:[0-9a-f]{16}$/);
      assert.equal(first.idempotencyKey.startsWith('create:'), false);
    });
    const other = fakeTracker();
    await withClient(other, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: ' ashby ', roleTitle: 'product manager' });
    });
    assert.equal(other.writes()[0].body.idempotencyKey, fake.writes()[0].body.idempotencyKey);
  });

  await t.test('returns the existing entry without writing when the job is already on the board', async () => {
    const fake = fakeTracker({ jobs: JOBS });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652000911 });
      assert.equal(isError, false);
      assertMatch(body, { created: false, reason: 'already_tracked', application: { id: 11 } });
      const again = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'speak', roleTitle: 'product manager' });
      assertMatch(again.body, { created: false, reason: 'already_tracked', application: { id: 11 } });
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('does not add a twin when the same company and role were added by name before', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'Product Manager' } } });
    await withClient(fake, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Clay', roleTitle: 'Product Manager' });
      const byJob = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      assertMatch(byJob.body, { created: false, reason: 'already_tracked' });
      assert.equal(fake.writes().length, 1);
    });
  });

  await t.test('still creates when a same-titled entry is linked to a different job', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'Product Manager' }, 10: { companyName: 'Clay', title: 'Product Manager' } } });
    await withClient(fake, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      const other = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 10 });
      assert.equal(other.body.created, true);
      assert.equal(fake.writes().length, 2);
    });
  });

  await t.test('uses the given names with a jobId, and falls back to an unlinked entry when the job is gone', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay Labs, Inc.', title: 'PM II', location: 'NYC', jobUrl: 'https://clay.example.com/pm' } } });
    await withClient(fake, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9, companyName: 'Clay', roleTitle: 'Product Manager' });
      assertMatch(fake.writes()[0].body, { companyName: 'Clay', roleTitle: 'Product Manager', jobPostingId: 9, location: 'NYC', link: 'https://clay.example.com/pm', idempotencyKey: 'mcp:job:9' });
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 77, companyName: 'Ashby', roleTitle: 'PM' });
      const gone = fake.writes()[1].body;
      assert.ok(!Object.hasOwn(gone, 'jobPostingId'));
      assert.match(gone.idempotencyKey, /^mcp:name:[0-9a-f]{16}$/);
    });
  });

  await t.test('matches any same company and role when a gone job falls back to an unlinked entry', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    await withClient(fake, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      const gone = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 77, companyName: 'Clay', roleTitle: 'PM' });
      assertMatch(gone.body, { created: false, reason: 'already_tracked' });
      assert.equal(fake.writes().length, 1);
    });
  });

  await t.test('reports a twin that a concurrent create added, without deleting anything', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    const racing = async (method, requestPath, body) => {
      if (method === 'POST' && requestPath === BASE) {
        // Another agent's create by name lands between this call's duplicate check and its write.
        fake.apps.set(81, { id: 81, jobPostingId: null, companyName: 'Clay', roleTitle: 'PM', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-09T08:00:00.000Z', version: 1, mergedIntoId: null });
      }
      return fake.requestApi(method, requestPath, body);
    };
    await withClient(racing, async (client) => {
      const { body } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      assert.equal(body.created, true);
      assert.deepEqual(body.possibleDuplicates.map((a) => a.id), [81]);
      assert.match(body.hint, /merge/);
      assert.ok(fake.writes().every((w) => w.method === 'POST'));
    });
  });

  await t.test('creates with given names when the job cannot be read right now', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    const limited = async (method, requestPath, body) => {
      if (requestPath === '/api/jobscout/jobs/9') throw httpError(429, { error: 'rate_limited' });
      return fake.requestApi(method, requestPath, body);
    };
    await withClient(limited, async (client) => {
      const { body } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9, companyName: 'Clay', roleTitle: 'PM' });
      assert.equal(body.created, true);
      assertMatch(fake.writes()[0].body, { jobPostingId: 9, companyName: 'Clay', roleTitle: 'PM' });
      const unnamed = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      assert.equal(unnamed.body.created, false);
    });
  });

  await t.test('keeps a committed create a success when the follow-up duplicate check fails', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    let posted = false;
    const flaky = async (method, requestPath, body) => {
      if (method === 'POST' && requestPath === BASE) posted = true;
      else if (posted && method === 'GET') throw httpError(404, { error: 'not_found' });
      return fake.requestApi(method, requestPath, body);
    };
    await withClient(flaky, async (client) => {
      const { body, isError } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      assert.equal(isError, false);
      assertMatch(body, { created: true, duplicateCheck: 'unavailable' });
      assert.match(body.hint, /was created/);
    });
  });

  await t.test('narrows a full name search and refuses to create when no search can be complete', async () => {
    const many = (n, company, role) => Array.from({ length: n }, (_, i) => ({
      id: 3000 + i, jobPostingId: null, companyName: company, roleTitle: `${role} ${i}`, link: null,
      currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 1, mergedIntoId: null,
    }));
    // 1,000 entries share the word "acme"; the next word narrows to the real twin, stored with different spacing.
    const narrowed = fakeTracker({ apps: [...many(1000, 'Acme Corp', 'Analyst'), { ...many(1, 'Acme   Labs', 'PM')[0], id: 11, roleTitle: 'PM' }], listCap: 1000 });
    await withClient(narrowed, async (client) => {
      const twin = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Acme  Labs', roleTitle: 'PM' });
      assertMatch(twin.body, { created: false, application: { id: 11 } });
      assert.deepEqual(narrowed.calls.map((c) => c.path), [`${BASE}?q=acme`, `${BASE}?q=labs`]);
    });
    const full = fakeTracker({ apps: many(1000, 'Acme', 'PM'), listCap: 1000 });
    await withClient(full, async (client) => {
      const { body, isError } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Acme', roleTitle: 'PM' });
      assert.equal(isError, true);
      assert.equal(body.error, 'duplicate_check_incomplete');
      assert.deepEqual(full.writes(), []);
    });
  });

  await t.test('returns the survivor when a repeated create replays an entry merged since', async () => {
    const fake = fakeTracker({ apps: [
      { id: 41, jobPostingId: null, companyName: 'Clay', roleTitle: 'Senior PM', link: null, currentStage: 'interview', stageEnteredAt: '2026-11-02T17:00:00.000Z', version: 3, mergedIntoId: null },
    ] });
    await withClient(fake, async (client) => {
      const args = { explicitUserConfirmed: true, companyName: 'Clay', roleTitle: 'PM' };
      const first = await call(client, 'trackly_create_tracker_application', args);
      fake.mergeInto(first.body.application.id, 41);
      const again = await call(client, 'trackly_create_tracker_application', args);
      assertMatch(again.body, { created: false, reason: 'already_tracked', application: { id: 41 } });
      assert.equal(fake.writes().filter((w) => w.method === 'POST').length, 2);
      assert.equal([...fake.apps.values()].filter((a) => a.mergedIntoId === null).length, 1);
    });
  });

  await t.test('never adds a second entry on a repeated call', async () => {
    const fake = fakeTracker({ jobs: JOBS });
    await withClient(fake, async (client) => {
      await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652276591 });
      const again = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652276591 });
      assert.equal(again.body.created, false);
      assert.equal(fake.writes().length, 1);
      assert.equal([...fake.apps.values()].filter((a) => a.jobPostingId === 652276591).length, 1);
    });
  });

  await t.test('returns not_found for an unknown Trackly job and tracker_unavailable when the gate is off, writing nothing', async () => {
    const fake = fakeTracker({ jobs: JOBS });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 123 });
      assert.equal(isError, true);
      assert.equal(body.error, 'not_found');
      assert.match(body.hint, /companyName and roleTitle/);
      assert.deepEqual(fake.writes(), []);
    });
    const off = fakeTracker({ enabled: false, jobs: JOBS });
    await withClient(off, async (client) => {
      const { body } = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652276591 });
      assert.equal(body.error, 'tracker_unavailable');
      assert.deepEqual(off.writes(), []);
    });
  });

  const invalidCreates = [
    {},
    { companyName: 'Clay' },
    { jobId: 1, roleTitle: 'PM' },
    { companyName: 'Clay', roleTitle: 'PM', appliedOn: '2026-13-01' },
    { companyName: 'Clay', roleTitle: 'PM', link: 'ftp://example.com/x' },
    { companyName: 'x'.repeat(201), roleTitle: 'PM' },
  ].map((args) => ({ explicitUserConfirmed: true, ...args })).concat([
    // Creating an entry records the job as applied: the user's explicit confirmation is required.
    { companyName: 'Clay', roleTitle: 'PM' },
    { companyName: 'Clay', roleTitle: 'PM', explicitUserConfirmed: false },
  ]);
  for (const args of invalidCreates) {
    await t.test(`rejects invalid input ${JSON.stringify(args).slice(0, 80)} without any HTTP call`, async () => {
      const fake = fakeTracker();
      await withClient(fake, async (client) => {
        assert.equal((await callRaw(client, 'trackly_create_tracker_application', args)).isError, true);
        assert.equal(fake.calls.length, 0);
      });
    });
  }
});

test('boards larger than the list route returns', async (t) => {
  const filler = (n) => Array.from({ length: n }, (_, i) => ({
    id: 2000 + i, jobPostingId: 100000 + i, companyName: `Filler ${i}`, roleTitle: 'Analyst', link: null,
    currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 1, mergedIntoId: null,
  }));
  const old = { id: 11, jobPostingId: 652000911, companyName: 'Speak', roleTitle: 'Product Manager', link: null, currentStage: 'applied', stageEnteredAt: '2026-01-01T00:00:00.000Z', version: 4, mergedIntoId: null };
  const jobs = { 652000911: { companyName: 'Speak', title: 'Product Manager' } };

  await t.test('finds an older entry by jobId through the route filter when the board read is full', async () => {
    const fake = fakeTracker({ apps: [...filler(1000), old], listCap: 1000, jobs });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_update_tracker_stage', { jobId: 652000911, stage: 'rejected' });
      assert.equal(isError, false);
      assertMatch(body.application, { id: 11, currentStage: 'rejected' });
      assert.ok(fake.calls.map((c) => `${c.method} ${c.path}`).includes(`GET ${BASE}?jobPostingId=652000911`));
    });
  });

  await t.test('lists an older entry by jobId when the board read is full', async () => {
    const fake = fakeTracker({ apps: [...filler(1000), old], listCap: 1000, jobs });
    await withClient(fake, async (client) => {
      const { body } = await call(client, 'trackly_list_tracker_applications', { jobId: 652000911 });
      assert.deepEqual(body.applications.map((a) => a.id), [11]);
      const filtered = await call(client, 'trackly_list_tracker_applications', { jobId: 652000911, stage: 'rejected' });
      assert.equal(filtered.body.count, 0);
    });
  });

  await t.test('resolves a job whose entry was merged into an unlinked entry, and does not add it again', async () => {
    const fake = fakeTracker({ apps: [
      { id: 31, jobPostingId: 5, companyName: 'Ashby', roleTitle: 'PM', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 3, mergedIntoId: 32 },
      { id: 32, jobPostingId: null, companyName: 'Ashby', roleTitle: 'Product Manager', link: null, currentStage: 'applied', stageEnteredAt: '2026-11-01T00:00:00.000Z', version: 7, mergedIntoId: null },
    ], jobs: { 5: { companyName: 'Ashby', title: 'PM' } } });
    await withClient(fake, async (client) => {
      const listed = await call(client, 'trackly_list_tracker_applications', { jobId: 5 });
      assert.deepEqual(listed.body.applications.map((a) => a.id), [32]);
      const moved = await call(client, 'trackly_update_tracker_stage', { jobId: 5, stage: 'rejected' });
      assertMatch(moved.body.application, { id: 32, currentStage: 'rejected' });
      const created = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 5 });
      assertMatch(created.body, { created: false, application: { id: 32 } });
      assert.deepEqual(fake.writes().map((w) => w.path), [`${BASE}/32/events`]);
    });
  });

  await t.test('matches a company name with different spacing when checking for a twin', async () => {
    const fake = fakeTracker({ apps: [...filler(1000), { ...old, jobPostingId: null, companyName: 'Acme Labs', roleTitle: 'PM' }], listCap: 1000 });
    await withClient(fake, async (client) => {
      const twin = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Acme  Labs', roleTitle: 'pm' });
      assertMatch(twin.body, { created: false, application: { id: 11 } });
      assert.deepEqual(fake.writes(), []);
    });
  });

  await t.test('does not create a duplicate of an older entry when the board read is full', async () => {
    const fake = fakeTracker({ apps: [...filler(1000), old], listCap: 1000, jobs });
    await withClient(fake, async (client) => {
      const byJob = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 652000911 });
      assertMatch(byJob.body, { created: false, application: { id: 11 } });
      const byName = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, companyName: 'Speak', roleTitle: 'Product Manager' });
      assertMatch(byName.body, { created: false, application: { id: 11 } });
      assert.deepEqual(fake.writes(), []);
    });
  });
});

test('trackly_retract_tracker_event', async (t) => {
  await t.test('is annotated destructive and says it retracts one event the user names', async () => {
    await withClient(noBackend(), async (client) => {
      const { tools } = await client.listTools();
      const tool = tools.find((value) => value.name === 'trackly_retract_tracker_event');
      assertMatch(tool.annotations, { destructiveHint: true, readOnlyHint: false });
      assert.match(tool.description, /one Tracker event that the user names/);
      assert.deepEqual(tool.inputSchema.required, ['eventId']);
    });
  });

  await t.test('retracts with the read version and returns the recomputed entry', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const moved = await call(client, 'trackly_update_tracker_stage', { applicationId: 11, stage: 'rejected', occurredOn: '2026-11-09' });
      const { body, isError } = await call(client, 'trackly_retract_tracker_event', { applicationId: 11, eventId: moved.body.stageEventId });
      assert.equal(isError, false);
      const retract = fake.writes()[1];
      assert.equal(retract.path, `${BASE}/11/events/900/retract`);
      assert.deepEqual(retract.body, { expectedVersion: 5 });
      assertMatch(body, { retractedEventId: 900, application: { id: 11, version: 6 } });
      assert.ok(fake.events.some((e) => e.retractsEventId === 900));
    });
  });

  await t.test('retries once on 409 with the version from the 409 body', async () => {
    const fake = fakeTracker({ conflicts: 1 });
    await withClient(fake, async (client) => {
      const { isError } = await call(client, 'trackly_retract_tracker_event', { applicationId: 11, eventId: 500 });
      assert.equal(isError, false);
      assert.deepEqual(fake.writes().map((w) => w.body), [{ expectedVersion: 4 }, { expectedVersion: 5 }]);
      assert.equal(fake.calls.filter((c) => c.method === 'GET').length, 1);
    });
  });

  await t.test('passes through cannot_retract_only_stage and not_found without writing', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    await withClient(fake, async (client) => {
      const created = await call(client, 'trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      const onlyStage = fake.newEvents().find((e) => e.applicationId === created.body.application.id);
      const { body, isError } = await call(client, 'trackly_retract_tracker_event', { applicationId: created.body.application.id, eventId: onlyStage.id });
      assert.equal(isError, true);
      assertMatch(body, { error: 'cannot_retract_only_stage', currentStage: 'applied' });
      const missingEvent = await call(client, 'trackly_retract_tracker_event', { applicationId: 11, eventId: 4242 });
      assert.equal(missingEvent.body.error, 'not_found');
      assert.deepEqual(fake.events.filter((e) => e.retractsEventId !== null), []);
    });
  });

  await t.test('passes through cannot_retract_retraction without writing', async () => {
    const fake = fakeTracker({ retractError: { status: 400, body: { error: 'cannot_retract_retraction' } } });
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_retract_tracker_event', { applicationId: 11, eventId: 500 });
      assert.equal(isError, true);
      assert.equal(body.error, 'cannot_retract_retraction');
      assert.deepEqual(fake.events.filter((e) => e.retractsEventId !== null), []);
    });
  });

  for (const args of [
    { eventId: 5 },
    { applicationId: 11, jobId: 1, eventId: 5 },
    { applicationId: 11 },
    { applicationId: 11, eventId: 0 },
  ]) {
    await t.test(`rejects invalid input ${JSON.stringify(args)} without any HTTP call`, async () => {
      const fake = fakeTracker();
      await withClient(fake, async (client) => {
        assert.equal((await callRaw(client, 'trackly_retract_tracker_event', args)).isError, true);
        assert.equal(fake.calls.length, 0);
      });
    });
  }
});

test('Tracker events and contact emails', async (t) => {
  await t.test('lists one entry with its events when applicationId is given', async () => {
    const fake = fakeTracker();
    await withClient(fake, async (client) => {
      const { body, isError } = await call(client, 'trackly_list_tracker_applications', { applicationId: 11 });
      assert.equal(isError, false);
      assert.deepEqual(fake.calls, [{ method: 'GET', path: `${BASE}/11` }]);
      assert.deepEqual(body.applications.map((a) => a.id), [11]);
      assert.deepEqual(body.events.map((e) => e.id), [498, 500]);
      assert.equal(typeof body.events[1].observedAt, 'string');
      assert.deepEqual(body.events[1], {
        id: 500, kind: 'company_contact', fromStage: null, toStage: null, occurredAt: '2026-11-03', occurredPrecision: 'local_date',
        observedAt: body.events[1].observedAt, status: 'confirmed', effective: true, supersedesEventId: null, retractsEventId: null,
        // An allowlist of scalar fields: contactEmail, a field not yet listed as public, and a nested value are left out.
        payload: { contactType: 'reply', contactName: 'Pat Recruiter' },
      });
      const combined = await client.callTool({ name: 'trackly_list_tracker_applications', arguments: { applicationId: 11, stage: 'applied' } });
      assert.equal(combined.isError, true);
    });
  });

  await t.test('never returns a contact email from any Tracker tool output on the public MCP', async () => {
    const fake = fakeTracker({ jobs: { 9: { companyName: 'Clay', title: 'PM' } } });
    const outputs = [];
    await withClient(fake, async (client) => {
      const run = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        outputs.push(JSON.stringify(result));
      };
      await run('trackly_list_tracker_applications', {});
      await run('trackly_list_tracker_applications', { applicationId: 11 });
      await run('trackly_list_tracker_applications', { jobId: 652000911 });
      await run('trackly_create_tracker_application', { explicitUserConfirmed: true, jobId: 9 });
      await run('trackly_update_tracker_stage', { applicationId: 11, stage: 'interview', note: 'call booked' });
      await run('trackly_add_tracker_note', { applicationId: 11, text: 'thank-you sent' });
      await run('trackly_retract_tracker_event', { applicationId: 11, eventId: 500 });
      await run('trackly_list_tracker_applications', { applicationId: 11 });
    });
    assert.equal(outputs.length, 8);
    for (const output of outputs) {
      assert.ok(!output.includes(PRIVATE_EMAIL));
      assert.ok(!output.includes('contactEmail'));
    }
  });
});
