'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const {
  buildRecommendationsResult,
  fetchRecommendations,
  formatBatchDate,
  isTodaysBatch,
  normalizeRecommendations,
  pilotTodayKey,
} = require('../lib/recommendations');
const { createTempConfigDir, seedApiKey, startMockServer, runCli } = require('./helpers');

// 2026-10-04 03:00 UTC is still Oct 3 in America/Los_Angeles.
const NOW = new Date('2026-10-04T03:00:00Z');
const TODAY = '2026-10-03';

function pick(jobId, extra = {}) {
  return {
    jobId,
    explanation: `Reason ${jobId}`,
    explanationStatus: 'present',
    gaps: ['No SQL listed'],
    isStretch: false,
    score: 0.91,
    ...extra,
  };
}

function digest(recommendations) {
  return { success: true, groups: [], generatedAt: NOW.toISOString(), ...(recommendations ? { recommendations } : {}) };
}

function detail(id, extra = {}) {
  return { job: { id, title: `Job ${id}`, companyName: `Co ${id}`, location: 'Remote', jobUrl: `https://jobs.example/${id}`, userStatus: 'new', isActive: true, ...extra } };
}

test('pilot date uses America/Los_Angeles, not UTC', () => {
  assert.equal(pilotTodayKey(NOW), TODAY);
  assert.equal(isTodaysBatch(TODAY, NOW), true);
  assert.equal(isTodaysBatch('2026-10-04', NOW), false);
  assert.equal(isTodaysBatch(null, NOW), false);
  assert.equal(isTodaysBatch('2026-02-31', NOW), false);
  assert.equal(formatBatchDate('2026-09-27', NOW), 'Sep 27');
  assert.equal(formatBatchDate('2025-09-27', NOW), 'Sep 27, 2025');
  assert.equal(formatBatchDate('nope', NOW), null);
});

test('absent recommendations block means not enabled', () => {
  const result = buildRecommendationsResult(digest(null), { now: NOW });
  assert.equal(result.enabled, false);
  assert.equal(result.status, null);
  assert.match(result.message, /not enabled for this account/i);
  assert.deepEqual(result.picks, []);
});

test('delivered batch from today yields picks and never exposes a score', () => {
  const details = new Map([[1, detail(1)], [2, detail(2)]]);
  const result = buildRecommendationsResult(
    digest({ date: TODAY, status: 'delivered', picks: [pick(1), pick(2)] }),
    { now: NOW, jobDetails: details },
  );
  assert.equal(result.status, 'delivered');
  assert.equal(result.isToday, true);
  assert.equal(result.message, null);
  assert.equal(result.picks.length, 2);
  assert.deepEqual(result.picks[0], {
    jobId: 1,
    title: 'Job 1',
    company: 'Co 1',
    location: 'Remote',
    jobUrl: 'https://jobs.example/1',
    reason: 'Reason 1',
    gaps: ['No SQL listed'],
    isStretch: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /score|0\.91/);
});

test('score is stripped even when nested in a hydrated job object', () => {
  const block = normalizeRecommendations({
    date: TODAY,
    status: 'delivered',
    picks: [{ ...pick(5), job: { id: 5, title: 'T', company: 'C', score: 0.5, matchScore: 0.4 } }],
  });
  const result = buildRecommendationsResult(digest({
    date: TODAY, status: 'delivered', picks: [{ ...pick(5), job: { id: 5, title: 'T', company: 'C', score: 0.5 } }],
  }), { now: NOW });
  assert.equal(result.picks[0].title, 'T');
  assert.equal(result.picks[0].company, 'C');
  assert.doesNotMatch(JSON.stringify(block), /score/i);
  assert.doesNotMatch(JSON.stringify(result), /score/i);
});

test('missing or blank explanation omits the reason and never prints an empty string', () => {
  for (const explanation of [null, '', '   ', undefined, 42]) {
    const result = buildRecommendationsResult(
      digest({ date: TODAY, status: 'delivered', picks: [pick(1, { explanation, explanationStatus: 'missing' })] }),
      { now: NOW },
    );
    assert.equal('reason' in result.picks[0], false, `reason for ${JSON.stringify(explanation)}`);
  }
});

test('null or empty gaps are omitted and null isStretch carries no marker', () => {
  for (const gaps of [null, [], ['', '  '], undefined]) {
    const result = buildRecommendationsResult(
      digest({ date: TODAY, status: 'delivered', picks: [pick(1, { gaps, isStretch: null })] }),
      { now: NOW },
    );
    assert.equal('gaps' in result.picks[0], false);
    assert.equal('isStretch' in result.picks[0], false);
  }
  const stretch = buildRecommendationsResult(
    digest({ date: TODAY, status: 'delivered', picks: [pick(1, { isStretch: true })] }),
    { now: NOW },
  );
  assert.equal(stretch.picks[0].isStretch, true);
});

test('server text cannot inject terminal control characters', () => {
  const result = buildRecommendationsResult(
    digest({ date: TODAY, status: 'delivered', picks: [pick(1, { explanation: 'Good\u001b[31m fit\u0007' })] }),
    { now: NOW },
  );
  assert.doesNotMatch(result.picks[0].reason, /[\u0000-\u001f]/);
});

test('invalid and duplicate pick ids are dropped; a delivered block with no valid picks is unavailable', () => {
  const block = normalizeRecommendations({
    date: TODAY, status: 'delivered', picks: [pick(1), pick(1), pick(-3), pick('x'), null],
  });
  assert.deepEqual(block.picks.map((p) => p.jobId), [1]);
  const empty = normalizeRecommendations({ date: TODAY, status: 'delivered', picks: [] });
  assert.equal(empty.status, 'unavailable');
  assert.equal(normalizeRecommendations({ status: 'surprise', picks: [pick(1)] }).status, 'unavailable');
  assert.equal(normalizeRecommendations('junk').status, 'unavailable');
});

test('every non-delivered status is neutral, blames nobody, and keeps the raw status', () => {
  const expectations = {
    zero_match: /^Nothing new today/,
    insufficient_context: /^Nothing new today/,
    absent: /^Nothing new today/,
  };
  for (const [status, pattern] of Object.entries(expectations)) {
    const result = buildRecommendationsResult(digest({ date: TODAY, status, picks: [pick(1)] }), { now: NOW });
    assert.equal(result.enabled, true);
    assert.equal(result.status, status);
    assert.deepEqual(result.picks, []);
    assert.match(result.message, pattern);
    assert.doesNotMatch(result.message, /you (did|didn't|need to|should|must|forgot)|your fault|please (add|update|complete)/i);
  }
  const unavailable = buildRecommendationsResult(digest({ date: null, status: 'unavailable', picks: [] }), { now: NOW });
  assert.equal(unavailable.status, 'unavailable');
  assert.match(unavailable.message, /couldn't be loaded/i);
});

test('failed never reads as success or as a quiet day', () => {
  const result = buildRecommendationsResult(digest({ date: TODAY, status: 'failed', picks: [] }), { now: NOW });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.picks, []);
  assert.match(result.message, /did not run/i);
  assert.match(result.message, /not an empty day/i);
  assert.doesNotMatch(result.message, /^Nothing new today/);
  assert.doesNotMatch(result.message, /quiet day|normal|all caught up/i);
});

test('a delivered batch from an earlier day reports stale and shows no picks', () => {
  const result = buildRecommendationsResult(
    digest({ date: '2026-10-01', status: 'delivered', picks: [pick(1)] }),
    { now: NOW, jobDetails: new Map([[1, detail(1)]]) },
  );
  assert.equal(result.status, 'delivered');
  assert.equal(result.isToday, false);
  assert.deepEqual(result.picks, []);
  assert.match(result.message, /Oct 1/);
  assert.match(result.message, /today's haven't arrived/i);
});

test('a delivered batch with a missing or impossible date shows no picks', () => {
  for (const date of [null, '2026-02-31', 'yesterday']) {
    const result = buildRecommendationsResult(digest({ date, status: 'delivered', picks: [pick(1)] }), { now: NOW });
    assert.deepEqual(result.picks, []);
    assert.match(result.message, /couldn't confirm which day/i);
  }
});

test('stale failed and zero_match batches are dated, not described as today', () => {
  const failed = buildRecommendationsResult(digest({ date: '2026-10-01', status: 'failed', picks: [] }), { now: NOW });
  assert.match(failed.message, /Oct 1/);
  assert.match(failed.message, /not an empty day/i);
  const zero = buildRecommendationsResult(digest({ date: '2026-10-01', status: 'zero_match', picks: [] }), { now: NOW });
  assert.match(zero.message, /Oct 1/);
});

test('handled and closed picks are dropped using live job state', () => {
  const details = new Map([
    [1, detail(1)],
    [2, detail(2, { userStatus: 'applied_confirmed' })],
    [3, detail(3, { isActive: false })],
  ]);
  const result = buildRecommendationsResult(
    digest({ date: TODAY, status: 'delivered', picks: [pick(1), pick(2), pick(3)] }),
    { now: NOW, jobDetails: details },
  );
  assert.deepEqual(result.picks.map((p) => p.jobId), [1]);
  assert.equal(result.handledCount, 1);
  assert.equal(result.closedCount, 1);

  const allGone = buildRecommendationsResult(
    digest({ date: TODAY, status: 'delivered', picks: [pick(2)] }),
    { now: NOW, jobDetails: new Map([[2, detail(2, { userStatus: 'check_later' })]]) },
  );
  assert.deepEqual(allGone.picks, []);
  assert.match(allGone.message, /handled every pick for today/i);
});

test('a job lookup failure keeps the pick id-only so agents can still chain by jobId', async () => {
  const request = async (method, endpoint) => {
    if (endpoint === '/api/jobscout/digest') return digest({ date: TODAY, status: 'delivered', picks: [pick(7)] });
    throw { status: 500, error: 'boom' };
  };
  const result = await fetchRecommendations(request, { now: NOW });
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].jobId, 7);
  assert.equal(result.picks[0].title, null);
  assert.match(result.picks[0].note, /could not be loaded/i);
});

test('fetchRecommendations maps 403 to not enabled and 503 or network failures to retryable errors', async () => {
  const forbidden = await fetchRecommendations(async () => { throw { status: 403, error: 'Forbidden' }; }, { now: NOW });
  assert.equal(forbidden.enabled, false);

  await assert.rejects(
    fetchRecommendations(async () => { throw { status: 503, code: 'digest_unavailable', error: 'Inbox is temporarily unavailable' }; }),
    (error) => error.retryable === true && error.status === 503 && /try again/i.test(error.error),
  );
  await assert.rejects(
    fetchRecommendations(async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }),
    (error) => error.retryable === true && /try again/i.test(error.error),
  );
});

test('fetchRecommendations leaves auth and access errors to the caller', async () => {
  const unauthorized = { status: 401, error: 'Unauthorized' };
  await assert.rejects(fetchRecommendations(async () => { throw unauthorized; }), (error) => error === unauthorized);
  const { createTracklyAccessError } = require('../lib/client');
  const access = createTracklyAccessError({ code: 'INVITATION_REQUIRED' }, 403);
  await assert.rejects(fetchRecommendations(async () => { throw access; }), (error) => error === access);
});

// ---- spawned CLI + real MCP transport against a mock backend ----

function backend(handler) {
  return startMockServer((req, res) => {
    const r = handler(req) || { status: 200, json: {} };
    res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.json || {}));
  });
}

async function runCliAgainst(t, args, handler) {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedApiKey(dir);
  const { server, port } = await backend(handler);
  t.after(() => server.close());
  return runCli(args, {
    TRACKLY_CONFIG_DIR: dir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    NO_COLOR: '1',
  });
}

function liveToday() {
  return pilotTodayKey(new Date());
}

function deliveredHandler(req) {
  if (req.url === '/api/jobscout/digest') {
    return { json: digest({ date: liveToday(), status: 'delivered', picks: [pick(11), pick(12, { explanation: null, gaps: null, isStretch: true })] }) };
  }
  const id = Number(req.url.split('/').pop());
  return { json: detail(id) };
}

test('trackly recommendations --json prints picks, status, and no score', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--json'], deliveredHandler);
  assert.equal(result.code, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'delivered');
  assert.deepEqual(out.picks.map((p) => p.jobId), [11, 12]);
  assert.equal(out.picks[0].jobUrl, 'https://jobs.example/11');
  assert.doesNotMatch(result.stdout, /score/);
});

test('trackly picks is an alias for recommendations', async (t) => {
  const result = await runCliAgainst(t, ['picks', '--json'], deliveredHandler);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).picks.map((p) => p.jobId), [11, 12]);
});

test('trackly recommendations exits 0 with a not-enabled message when the block is absent', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--json'], () => ({ json: digest(null) }));
  assert.equal(result.code, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.enabled, false);
  assert.match(out.message, /not enabled/i);
});

test('trackly recommendations treats HTTP 403 as not enabled with exit 0', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--json'], () => ({ status: 403, json: { success: false, error: 'Forbidden' } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).enabled, false);
});

test('trackly recommendations reports 503 digest_unavailable as a retryable failure', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--json'], () => ({
    status: 503,
    json: { success: false, error: 'Inbox is temporarily unavailable', code: 'digest_unavailable' },
  }));
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /try again/i);
});

test('trackly recommendations --json keeps the raw failed status', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--json'], () => ({
    json: digest({ date: liveToday(), status: 'failed', picks: [] }),
  }));
  assert.equal(result.code, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'failed');
  assert.deepEqual(out.picks, []);
  assert.match(out.message, /not an empty day/i);
});

test('recommendations rejects unknown flags like other commands', async (t) => {
  const result = await runCliAgainst(t, ['recommendations', '--bogus'], () => ({ json: digest(null) }));
  assert.notEqual(result.code, 0);
});

test('formatter text output omits blank reasons and unknown stretch markers', () => {
  const { outputRecommendations } = require('../lib/formatters');
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  const argv = process.argv;
  try {
    process.env.NO_COLOR = '1';
    // isJSON() is true for non-TTY stdout; force the human path.
    const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      outputRecommendations({
        picks: [
          { jobId: 1, title: 'A', company: 'Co', location: 'NYC', jobUrl: 'https://x.test/1', reason: 'Fits', gaps: ['SQL'], isStretch: true },
          { jobId: 2, title: 'B', company: 'Co2', location: null, jobUrl: null },
        ],
      });
      outputRecommendations({ picks: [], message: 'Nothing new today. Quiet.' });
    } finally {
      if (ttyDescriptor) Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
      else delete process.stdout.isTTY;
    }
  } finally {
    console.log = original;
    process.argv = argv;
    delete process.env.NO_COLOR;
  }
  const text = lines.join('\n');
  assert.match(text, /A \[stretch\]/);
  assert.match(text, /Why: Fits/);
  assert.match(text, /Gaps: SQL/);
  assert.match(text, /ID: 2/);
  assert.doesNotMatch(text, /B \[stretch\]/);
  assert.equal((text.match(/Why:/g) || []).length, 1);
  assert.equal((text.match(/Gaps:/g) || []).length, 1);
  assert.match(text, /Nothing new today\. Quiet\./);
});

test('trackly_get_recommendations is a read-only MCP tool that returns picks without a score', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const { server: http, port } = await backend(deliveredHandler);
  t.after(() => http.close());

  const saved = {
    TRACKLY_CONFIG_DIR: process.env.TRACKLY_CONFIG_DIR,
    TRACKLY_API_KEY: process.env.TRACKLY_API_KEY,
    TRACKLY_BASE_URL: process.env.TRACKLY_BASE_URL,
  };
  process.env.TRACKLY_CONFIG_DIR = configDir;
  process.env.TRACKLY_API_KEY = 'trk_test_recs';
  process.env.TRACKLY_BASE_URL = `http://127.0.0.1:${port}`;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createServer();
  const client = new Client({ name: 'recs-test', version: '1.0.0' });
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close().catch(() => {});
    await mcpServer.close().catch(() => {});
  });

  const listed = await client.listTools();
  const tool = listed.tools.find((entry) => entry.name === 'trackly_get_recommendations');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);

  const response = await client.callTool({ name: 'trackly_get_recommendations', arguments: {} });
  assert.ok(!response.isError);
  const out = JSON.parse(response.content[0].text);
  assert.equal(out.status, 'delivered');
  assert.deepEqual(out.picks.map((p) => p.jobId), [11, 12]);
  assert.doesNotMatch(response.content[0].text, /score/);
});

test('trackly_get_recommendations returns a retryable error on 503 and not-enabled on 403', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  let mode = 503;
  const { server: http, port } = await backend(() => (mode === 503
    ? { status: 503, json: { success: false, error: 'Inbox is temporarily unavailable', code: 'digest_unavailable' } }
    : { status: 403, json: { success: false, error: 'Forbidden' } }));
  t.after(() => http.close());

  const saved = {
    TRACKLY_CONFIG_DIR: process.env.TRACKLY_CONFIG_DIR,
    TRACKLY_API_KEY: process.env.TRACKLY_API_KEY,
    TRACKLY_BASE_URL: process.env.TRACKLY_BASE_URL,
  };
  process.env.TRACKLY_CONFIG_DIR = configDir;
  process.env.TRACKLY_API_KEY = 'trk_test_recs';
  process.env.TRACKLY_BASE_URL = `http://127.0.0.1:${port}`;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createServer();
  const client = new Client({ name: 'recs-test', version: '1.0.0' });
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close().catch(() => {});
    await mcpServer.close().catch(() => {});
  });

  const unavailable = await client.callTool({ name: 'trackly_get_recommendations', arguments: {} });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /try again/i);

  mode = 403;
  const forbidden = await client.callTool({ name: 'trackly_get_recommendations', arguments: {} });
  assert.ok(!forbidden.isError);
  assert.equal(JSON.parse(forbidden.content[0].text).enabled, false);
});

test('recommendations docs name the command, alias, and tool', () => {
  const root = path.join(__dirname, '..');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /trackly recommendations/);
  assert.match(readme, /trackly picks/);
  assert.match(fs.readFileSync(path.join(root, 'docs', 'trackly-tools.md'), 'utf8'), /trackly_get_recommendations/);
});

test('at most 5 picks are resolved and shown', async () => {
  const lookups = [];
  const request = async (method, endpoint) => {
    if (endpoint === '/api/jobscout/digest') {
      return digest({ date: TODAY, status: 'delivered', picks: [1, 2, 3, 4, 5, 6, 7].map((id) => pick(id)) });
    }
    lookups.push(endpoint);
    return detail(Number(endpoint.split('/').pop()));
  };
  const result = await fetchRecommendations(request, { now: NOW });
  assert.equal(result.picks.length, 5);
  assert.equal(lookups.length, 5);
  assert.equal(result.truncated, 2);
});
