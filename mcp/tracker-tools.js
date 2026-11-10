'use strict';

// Local MCP Tracker tools: list Tracker entries, create one, move one to a new
// stage, add a dated note, and retract one event. Mirror of the hosted tools
// (close-ai src/mcp/tracker-tools.ts at 6cd11dfb, PR #3603; trackly-app/close-ai#3600).
//
// The tools add no write path of their own. They call the existing Waypoint
// routes with the user's own credentials, exactly as the web board does, so
// ownership, history, undo and the expectedVersion check stay in the backend.
// Every write reads the entry first, sends its version, retries once on a
// version conflict using the version the 409 body carries, and uses a
// deterministic idempotency key so a repeated call replays the stored write
// instead of adding a second one. Any error before a write returns without
// writing. No output carries a contact email.

const { createHash } = require('node:crypto');
const { z } = require('zod');
const {
  WAYPOINT_STAGES, isDate, validZone, fromZonedTime, formatDateInZone, reduceStage,
} = require('./waypoint-reducer');

const TRACKER_APPLICATIONS_PATH = '/api/jobscout/waypoint/applications';
const TRACKER_SOURCES_PATH = '/api/jobscout/waypoint/sources';
/** Dates the agent passes are calendar days in this zone; the board renders local_date events in it. */
const TRACKER_DEFAULT_TZ = 'America/Los_Angeles';
const TRACKER_NOTE_MAX = 1000;
/** Quick Add's own limits. */
const NAME_MAX = 200;
const LINK_MAX = 2048;
/** The list route returns at most this many entries. */
const LIST_CAP = 1000;
/** How many retracted copies of one note a re-add follows before giving up. */
const NOTE_REDO_LIMIT = 10;
/** Waypoint and job posting ids are Postgres integers. */
const PG_INT_MAX = 2_147_483_647;

/**
 * The fields lib/client.js attaches to an HTTP error: the status, and the
 * backend's JSON body spread at the top level (the hosted client nests it under
 * responseBody). Only `error` and `application` are ever read from the body.
 */
function apiError(caught) {
  if (!caught || typeof caught !== 'object') return {};
  return { status: caught.status, responseBody: caught };
}

/** A structured tool error. Its payload is the whole MCP error body, so it never carries backend text. */
class TrackerToolError extends Error {
  constructor(status, payload) {
    super(String(payload.error));
    this.name = 'TrackerToolError';
    this.status = status;
    this.payload = payload;
  }
}

// Factories, not shared instances: a reused zod instance renders as a JSON Schema $ref, which some MCP clients reject.
const positiveId = () => z.number().int().positive().max(PG_INT_MAX);
const calendarDate = (what) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isDate, `${what} must be a real calendar date in YYYY-MM-DD form`);
const occurredOn = () => calendarDate('occurredOn')
  .describe(`Calendar date the change happened, YYYY-MM-DD, read as a local date in ${TRACKER_DEFAULT_TZ}. Omit to use the time of the call.`);
const noteText = () => z.string().min(1).max(TRACKER_NOTE_MAX).refine((v) => v.trim().length > 0, 'note text cannot be blank');
const nameText = () => z.string().min(1).max(NAME_MAX).refine((v) => v.trim().length > 0, 'cannot be blank');
const httpLink = () => z.string().max(LINK_MAX).url().refine((v) => /^https?:\/\//i.test(v), 'link must be an http(s) URL');

function trackerListShape() {
  return {
    stage: z.enum(WAYPOINT_STAGES).optional().describe(`Only entries currently in this stage. One of: ${WAYPOINT_STAGES.join(', ')}`),
    query: z.string().max(100).optional().describe('Company or role text to match, up to 100 characters'),
    jobId: positiveId().optional().describe('Trackly job posting ID; returns only the Tracker entries linked to that job'),
    applicationId: positiveId().optional().describe('One Tracker entry ID. Returns that entry with its events (ids, kinds, stages, dates and note text), so you can name an event for trackly_retract_tracker_event. Cannot be combined with the other filters.'),
  };
}

function targetShape() {
  return {
    applicationId: positiveId().optional().describe('Tracker entry ID from trackly_list_tracker_applications. Pass exactly one of applicationId or jobId.'),
    jobId: positiveId().optional().describe('Trackly job posting ID. Resolved to its Tracker entry. Pass exactly one of applicationId or jobId.'),
  };
}

function trackerStageShape() {
  return {
    ...targetShape(),
    stage: z.enum(WAYPOINT_STAGES).describe(`New Tracker stage. One of: ${WAYPOINT_STAGES.join(', ')}`),
    occurredOn: occurredOn().optional(),
    note: noteText().optional().describe(`Optional dated note saved after the stage change, up to ${TRACKER_NOTE_MAX} characters. Say where the evidence came from, for example "rejection email, Nov 9".`),
  };
}

function trackerNoteShape() {
  return {
    ...targetShape(),
    text: noteText().describe(`Note text, up to ${TRACKER_NOTE_MAX} characters. Say where the evidence came from.`),
    occurredOn: occurredOn().optional(),
  };
}

function trackerCreateShape() {
  return {
    jobId: positiveId().optional().describe('Trackly job posting ID. The company, role, location and default link come from the Trackly job. Pass jobId, or companyName and roleTitle (or both, to override the job\'s names).'),
    companyName: nameText().optional().describe(`Company name, up to ${NAME_MAX} characters. Required with roleTitle when there is no jobId; with a jobId it overrides the job's company name.`),
    roleTitle: nameText().optional().describe(`Role title, up to ${NAME_MAX} characters. Required with companyName when there is no jobId; with a jobId it overrides the job's title.`),
    appliedOn: calendarDate('appliedOn').optional().describe(`Date the user applied, YYYY-MM-DD, read as a local date in ${TRACKER_DEFAULT_TZ}. Omit when unknown.`),
    link: httpLink().optional().describe(`Posting or application URL, http(s), up to ${LINK_MAX} characters. Defaults to the Trackly job's URL when jobId is given.`),
    explicitUserConfirmed: z.literal(true).describe('Must be true: the user explicitly confirmed they applied to this job, because creating a Tracker entry records the job as applied.'),
  };
}

function trackerRetractShape() {
  return {
    ...targetShape(),
    eventId: positiveId().describe('The one event to retract, from trackly_list_tracker_applications with applicationId, or the stageEventId or noteEventId a write returned.'),
  };
}

/** The stored row behind an event view (the backend's toEventView, reversed). */
function eventRow(e) {
  const zone = e.occurredTz && validZone(e.occurredTz) ? e.occurredTz : 'UTC';
  const occurredAt = e.occurredAt == null ? null
    : e.occurredPrecision === 'local_date' ? fromZonedTime(`${e.occurredAt}T00:00:00`, zone) : new Date(e.occurredAt);
  const observedAt = new Date(e.observedAt);
  return {
    id: e.id, applicationId: e.applicationId ?? 0, userId: 0, kind: e.kind,
    fromStage: e.fromStage ?? null, toStage: e.toStage ?? null, occurredAt,
    occurredPrecision: e.occurredPrecision ?? null, occurredTz: e.occurredTz ?? null,
    observedAt, actor: e.actor === 'system' ? 'system' : 'user', status: e.status,
    lineageClass: e.lineageClass ?? 'C', payload: e.payload ?? {},
    supersedesEventId: e.supersedesEventId ?? null, retractsEventId: e.retractsEventId ?? null, idempotencyKey: null,
    createdAt: new Date(e.createdAt ?? e.observedAt),
  };
}

/**
 * Whether a new stage event would become the entry's current stage, decided by the Tracker's
 * reducer over the entry's real events (its ordering by date, precedence and observation time).
 */
function wouldBecomeCurrent(events, stage, fromStage, date, now) {
  // Like the route, a new stage change records the stage it moves from, so the reducer treats it as a user move.
  const candidate = eventRow({
    id: Number.MAX_SAFE_INTEGER, kind: 'stage_change', fromStage, toStage: stage, occurredAt: date ?? null,
    occurredPrecision: date ? 'local_date' : null, occurredTz: date ? TRACKER_DEFAULT_TZ : null, status: 'confirmed',
    effective: true, supersedesEventId: null, retractsEventId: null, observedAt: now.toISOString(), actor: 'user', payload: {},
  });
  return reduceStage([...events.map(eventRow), candidate]).currentStage === stage;
}

/**
 * The calendar day an event counts for: its local date or instant, or, when undated, the day it
 * was observed in the Tracker's zone. An undated correction keeps the day of the event it corrects,
 * as the reducer anchors it to the start of its supersede chain, so the chain is walked back to that root.
 */
function eventDay(e, events) {
  if (e.occurredAt != null && e.occurredPrecision === 'local_date') return e.occurredAt;
  if (e.occurredAt != null) return formatDateInZone(new Date(e.occurredAt), TRACKER_DEFAULT_TZ);
  let anchor = e;
  for (let hops = 0; anchor.supersedesEventId != null && hops < events.length; hops += 1) {
    const parent = events.find((x) => x.id === anchor.supersedesEventId);
    if (!parent) break;
    anchor = parent;
  }
  return formatDateInZone(new Date(anchor.observedAt), TRACKER_DEFAULT_TZ);
}

/** The compact view the tools return: the contract's fields, nothing else from the projection. */
function compactTrackerApplication(a) {
  return {
    id: a.id, jobPostingId: a.jobPostingId ?? null, company: a.companyName, role: a.roleTitle,
    currentStage: a.currentStage ?? null, stageEnteredAt: a.stageEnteredAt ?? null, version: a.version, link: a.link ?? null,
  };
}

/**
 * The payload fields the public MCP may return: an allowlist of the Tracker write schema's fields
 * minus contactEmail, which stays off the public MCP until the directory projection decision. A
 * field added to the schema later stays hidden until listed here.
 */
const PUBLIC_PAYLOAD_KEYS = new Set([
  'text', 'contactName', 'contactType', 'startsAt', 'endsAt', 'tz', 'kind', 'format', 'interviewEventId',
  'dueAt', 'precision', 'deadlineKind', 'label', 'control', 'value',
]);

function compactTrackerEvent(e) {
  // Listed fields are scalars in the write schema; a nested value is dropped rather than walked, so it
  // cannot carry contact data through.
  const payload = Object.fromEntries(Object.entries(e.payload ?? {})
    .filter(([key, value]) => PUBLIC_PAYLOAD_KEYS.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))));
  return {
    id: e.id, kind: e.kind, fromStage: e.fromStage ?? null, toStage: e.toStage ?? null, occurredAt: e.occurredAt ?? null,
    occurredPrecision: e.occurredPrecision ?? null, observedAt: e.observedAt ?? null, status: e.status, effective: e.effective === true,
    supersedesEventId: e.supersedesEventId ?? null, retractsEventId: e.retractsEventId ?? null, payload,
  };
}

function todayInTrackerZone(now = new Date()) {
  return formatDateInZone(now, TRACKER_DEFAULT_TZ);
}

const shortHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const normalizedName = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Same application, read version, stage and day: same key, so concurrent or retried duplicates
 * replay the stored event. The read version is part of the key because the route replays a key
 * even after its event was retracted or the card moved away; any such change bumps the version,
 * so a deliberate redo gets a fresh key.
 */
function trackerStageKey(applicationId, readVersion, stage, date, now = new Date()) {
  return `mcp:stage:${applicationId}:v${readVersion}:${stage}:${date ?? `observed-${todayInTrackerZone(now)}`}`;
}

/** Same application, text and day: a repeated note replays instead of adding a copy. */
function trackerNoteKey(applicationId, text, date, now = new Date()) {
  return `mcp:note:${applicationId}:${shortHash(text)}:${date ?? `observed-${todayInTrackerZone(now)}`}`;
}

/** A note replayed from a retracted copy is re-added under a key tied to that copy, so a repeat replays the new one. */
const redoKey = (key, replayedEventId) => `${key}:after-${replayedEventId}`;

/** One entry per job, or per company and role: the route stores it as create:<key> and replays it. */
function trackerCreateKey(input) {
  if (input.jobId !== undefined) return `mcp:job:${input.jobId}`;
  return `mcp:name:${shortHash(`${normalizedName(input.companyName)}\u0000${normalizedName(input.roleTitle)}`)}`;
}

function whenFields(date) {
  return date === undefined ? {} : { occurredAt: date, occurredPrecision: 'local_date', occurredTz: TRACKER_DEFAULT_TZ };
}

const invalidRequest = (hint) => new TrackerToolError(400, { error: 'invalid_request', hint });
const keyReused = () => new TrackerToolError(422, {
  error: 'idempotency_key_reused',
  hint: 'An earlier call recorded a different change under the same key. Nothing was written. Re-read the entry with trackly_list_tracker_applications, or pass a different date.',
});
const sameRole = (companyName, roleTitle) => (a) =>
  normalizedName(a.companyName) === normalizedName(companyName) && normalizedName(a.roleTitle) === normalizedName(roleTitle);
const unavailable = () => new TrackerToolError(404, {
  error: 'tracker_unavailable',
  hint: 'The Trackly Tracker is switched off for this account right now. Nothing was written.',
});
const notFound = (hint) => new TrackerToolError(404, { error: 'not_found', hint });
const NOTE_EDITED_HINT = 'This note was added earlier and has since been edited on the board, so nothing new was written. Read the entry\'s events with trackly_list_tracker_applications and applicationId before adding it again.';
const NO_ENTRY_HINT = 'This job has no Tracker entry yet. Nothing was written and no entry was created. Create it with trackly_create_tracker_application if the user wants it tracked, or check the ID with trackly_list_tracker_applications.';
// Fixed text: a 2xx body that is not a Tracker entry never reaches the agent's context.
const invalidResponse = () => new TrackerToolError(502, {
  error: 'invalid_tracker_response',
  hint: 'Trackly returned an unreadable Tracker response. Re-read the entry with trackly_list_tracker_applications before retrying.',
});

/** The 409 details the agent needs to report or retry: version, stage and merge target, never a generic error. */
function conflictDetails(app) {
  return {
    version: app.version,
    currentStage: app.currentStage ?? null,
    mergedIntoId: app.mergedIntoId ?? null,
    application: compactTrackerApplication(app),
  };
}

function conflict(app, alreadyInStage = false) {
  return new TrackerToolError(409, {
    error: 'version_conflict',
    ...conflictDetails(app),
    hint: alreadyInStage
      ? `The entry changed while this call ran and is now already in ${app.currentStage}. Nothing was written by this call.`
      : 'The entry kept changing while this call ran. Nothing was written. Re-read it with trackly_list_tracker_applications and retry once.',
  });
}

function merged(app) {
  return new TrackerToolError(409, {
    error: 'merged',
    ...conflictDetails(app),
    hint: 'This Tracker entry was merged into another one. Nothing was written. Use mergedIntoId as the applicationId.',
  });
}

/** Why a stage write left the entry in another stage: a replayed retracted event, or a later-dated stage event. */
function stageNotCurrent(event, app, stage) {
  if (event?.effective === false) {
    return {
      reason: 'replayed_retracted_event',
      hint: `This exact change was recorded and then undone earlier, so the Tracker replayed it and nothing new was written. The entry is still in ${app.currentStage}. Pass a different occurredOn to record it again.`,
    };
  }
  return {
    reason: 'later_stage_event',
    hint: `The ${stage} event was recorded, but a stage change the Tracker orders after it (a later date) keeps the entry in ${app.currentStage}. Do not repeat this call; check the dates with trackly_list_tracker_applications and applicationId.`,
  };
}

function exactlyOneTarget(applicationId, jobId) {
  if ((applicationId === undefined) === (jobId === undefined)) throw invalidRequest('Pass exactly one of applicationId or jobId.');
}

/** A short machine reason only: a Waypoint error code is a fixed snake_case token, never backend text. */
function noteErrorCode(caught) {
  if (caught instanceof TrackerToolError) return String(caught.payload.error);
  const code = apiError(caught).responseBody?.error;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'note_write_failed';
}

const isApplication = (v) => !!v && typeof v === 'object' && Number.isInteger(v.id) && Number.isInteger(v.version);

/** The entry a 2xx Tracker response carries, or a fixed error when it carries none. */
function applicationOf(response) {
  if (!isApplication(response?.application)) throw invalidResponse();
  return response.application;
}

/**
 * Build the five handlers over a request function `(method, path, body?) => Promise<json>` that
 * throws lib/client.js-shaped errors ({ ...body, status }).
 */
function createTrackerToolHandlers(requestApi) {
  /**
   * A 404 from the gate and a 404 for a missing entry look alike; the sources route tells them
   * apart. Only a 404 there means the Tracker is off; any other probe failure is passed on rather
   * than reported as not_found.
   */
  async function trackerIsOff() {
    try {
      await requestApi('GET', TRACKER_SOURCES_PATH);
      return false;
    } catch (caught) {
      if (apiError(caught).status === 404) return true;
      throw caught;
    }
  }

  async function missing(hint) {
    return (await trackerIsOff()) ? unavailable() : notFound(hint);
  }

  async function listApplications(params) {
    const qs = new URLSearchParams();
    if (params.stage) qs.set('stage', params.stage);
    if (params.query) qs.set('q', params.query);
    if (params.jobPostingId !== undefined) qs.set('jobPostingId', String(params.jobPostingId));
    const suffix = qs.toString();
    let response;
    try {
      response = await requestApi('GET', suffix ? `${TRACKER_APPLICATIONS_PATH}?${suffix}` : TRACKER_APPLICATIONS_PATH);
    } catch (caught) {
      // The list route has no 404 of its own: a 404 is the feature gate.
      if (apiError(caught).status === 404) throw unavailable();
      throw caught;
    }
    if (!Array.isArray(response?.applications)) return [];
    if (!response.applications.every(isApplication)) throw invalidResponse();
    return response.applications;
  }

  /** The Trackly job's names and links, or null when the job is gone. */
  async function fetchJob(jobId) {
    try {
      return (await requestApi('GET', `/api/jobscout/jobs/${jobId}`))?.job ?? null;
    } catch (caught) {
      if (apiError(caught).status === 404) return null;
      throw caught;
    }
  }

  /**
   * The entries that hold a job, from the route's own job filter: it matches before the page
   * limit, and it also returns the survivor an entry for the job was merged into, so a large
   * board or a merge cannot hide one.
   */
  function linkedEntries(jobId) {
    return listApplications({ jobPostingId: jobId });
  }

  /**
   * Entries that could be the same company and role. The route's text search is a substring match
   * on the raw name and returns at most LIST_CAP entries. Every query is one whitespace-free word of
   * the company name (longest first), then of the role: any entry that sameRole would match contains
   * that word whatever its spacing, so a page below the cap is complete. When every page is full the
   * check cannot be complete, so the create is refused rather than risk a twin.
   */
  async function nameCandidates(companyName, roleTitle) {
    const words = (v) => normalizedName(v).split(' ').filter(Boolean).sort((a, b) => b.length - a.length);
    const queries = [...new Set([...words(companyName), ...words(roleTitle)].map((q) => q.slice(0, 100)))];
    for (const query of queries) {
      const page = await listApplications({ query });
      if (page.length < LIST_CAP) return page;
    }
    throw new TrackerToolError(409, {
      error: 'duplicate_check_incomplete',
      hint: 'There are too many Tracker entries for this company and role to rule out a duplicate. Nothing was written. Pass jobId if the job is in Trackly, or add the entry on /tracker.',
    });
  }

  async function readDetail(applicationId) {
    let response;
    try {
      response = await requestApi('GET', `${TRACKER_APPLICATIONS_PATH}/${applicationId}`);
    } catch (caught) {
      if (apiError(caught).status === 404) throw await missing(`No Tracker entry with applicationId ${applicationId}. Nothing was written.`);
      throw caught;
    }
    return { application: applicationOf(response), events: Array.isArray(response.events) ? response.events : [] };
  }

  async function resolve(applicationId, jobId) {
    exactlyOneTarget(applicationId, jobId);
    if (applicationId !== undefined) return (await readDetail(applicationId)).application;
    const matches = await linkedEntries(jobId);
    if (matches.length === 0) throw notFound(NO_ENTRY_HINT);
    if (matches.length > 1) {
      throw new TrackerToolError(409, {
        error: 'ambiguous_job',
        candidates: matches.map(compactTrackerApplication),
        hint: 'More than one Tracker entry is linked to this job. Nothing was written. Pass the applicationId of the right one.',
      });
    }
    return matches[0];
  }

  /** The entry, plus its events when resolving already read them (by applicationId). */
  async function resolveWithEvents(applicationId, jobId) {
    exactlyOneTarget(applicationId, jobId);
    if (applicationId !== undefined) {
      const detail = await readDetail(applicationId);
      return { app: detail.application, events: detail.events };
    }
    return { app: await resolve(undefined, jobId) };
  }

  async function writable(applicationId, jobId) {
    const app = await resolve(applicationId, jobId);
    if (app.mergedIntoId != null) throw merged(app);
    return app;
  }

  /**
   * POST one write with the entry's version. On a version conflict, take the fresh entry from the
   * 409 body (a re-read only when the body lacks it) and retry once while `stillWanted` holds;
   * otherwise return the conflict with its version, stage and merge target. The idempotency key
   * stays the same.
   */
  async function postWithRetry(app, pathFor, build, stillWanted, notFoundHint) {
    let current = app;
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await requestApi('POST', pathFor(current.id), build(current.version));
      } catch (caught) {
        const error = apiError(caught);
        const code = error.responseBody?.error;
        const bodyApp = isApplication(error.responseBody?.application) ? error.responseBody.application : null;
        if (error.status === 409 && code === 'version_conflict') {
          const fresh = bodyApp ?? (await readDetail(current.id)).application;
          if (fresh.mergedIntoId != null) throw merged(fresh);
          if (attempt > 0) throw conflict(fresh);
          if (!stillWanted(fresh)) throw conflict(fresh, true);
          current = fresh;
          continue;
        }
        if (error.status === 409 && code === 'merged') throw merged(bodyApp ?? current);
        if (error.status === 404) throw await missing(notFoundHint(current.id));
        if (error.status === 422 && code === 'idempotency_key_reused') throw keyReused();
        if (error.status === 400 && (code === 'cannot_retract_only_stage' || code === 'cannot_retract_retraction')) {
          throw new TrackerToolError(400, {
            error: code,
            ...(bodyApp ? conflictDetails(bodyApp) : {}),
            hint: code === 'cannot_retract_only_stage'
              ? 'That is the entry\'s only stage event, so it cannot be retracted. Nothing was written. Move the stage instead.'
              : 'That event is itself a retraction and cannot be retracted. Nothing was written.',
          });
        }
        if (error.status === 400) throw invalidRequest('The Tracker rejected the change. Nothing was written.');
        throw caught;
      }
      return { application: applicationOf(response), event: response.event };
    }
  }

  const eventsPath = (id) => `${TRACKER_APPLICATIONS_PATH}/${id}/events`;
  const noEntryHint = (id) => `No Tracker entry with applicationId ${id}. Nothing was written.`;

  /**
   * Add one note. If the route replays a copy that was retracted since (same text and day), add it
   * once more under a key tied to that copy, so the user's redo lands and a repeat of the redo
   * replays it instead of adding a third. Resolves { application, event?, edited? }; edited means the
   * replayed copy was edited on the board since, so nothing was re-added.
   */
  async function postNote(app, text, date, now, known) {
    // Content first: the entry's events (merged entries' events included) are the record, whatever
    // key an earlier call used. The same text on the same day is either still there (nothing to
    // add), edited on the board (left as the user corrected it), or retracted (an undo the user may
    // be redoing, so it is added again below).
    const events = known ?? (await readDetail(app.id)).events;
    const day = date ?? todayInTrackerZone(now);
    const same = events.filter((e) => e.kind === 'note' && e.retractsEventId == null && e.payload?.text === text && eventDay(e, events) === day);
    const live = same.find((e) => e.effective);
    if (live) return { application: app, event: { id: live.id, effective: true } };
    const edited = same.find((e) => !events.some((r) => r.retractsEventId === e.id));
    if (edited) return { application: app, event: { id: edited.id, effective: false }, edited: true };

    const post = (target, idempotencyKey) => postWithRetry(
      target, eventsPath,
      (expectedVersion) => ({ kind: 'note', expectedVersion, ...whenFields(date), payload: { text }, idempotencyKey }),
      () => true,
      noEntryHint,
    );
    const key = trackerNoteKey(app.id, text, date, now);
    let result = await post(app, key);
    // Each re-add after an undo is keyed to the copy it replaces, so follow that chain to its live
    // end. A replayed copy is ineffective when it was retracted or when it was edited (superseded) on
    // the board; only a retraction is an undo to redo. An edited note stays as the user corrected
    // it, so its old text is never written again.
    for (let hop = 0; hop < NOTE_REDO_LIMIT && result.event?.effective === false && result.event.id !== undefined; hop += 1) {
      const replayedId = result.event.id;
      const retracted = (await readDetail(app.id)).events.some((e) => e.retractsEventId === replayedId);
      if (!retracted) return { ...result, edited: true };
      result = await post(result.application, redoKey(key, replayedId));
    }
    return result;
  }

  async function list(params) {
    if (params.applicationId !== undefined) {
      if (params.stage !== undefined || params.query !== undefined || params.jobId !== undefined) {
        throw invalidRequest('applicationId cannot be combined with stage, query or jobId.');
      }
      const detail = await readDetail(params.applicationId);
      return {
        applications: [compactTrackerApplication(detail.application)],
        count: 1,
        events: detail.events.map(compactTrackerEvent),
      };
    }
    // With jobId the route's job filter is complete for the job (merged entries included), not one page of the board.
    const applications = (await listApplications({ stage: params.stage, query: params.query, jobPostingId: params.jobId }))
      .map(compactTrackerApplication);
    return { applications, count: applications.length };
  }

  async function create(params) {
    if (params.explicitUserConfirmed !== true) throw invalidRequest('Creating a Tracker entry records the job as applied. Confirm with the user, then pass explicitUserConfirmed=true.');
    const named = params.companyName !== undefined && params.roleTitle !== undefined;
    if ((params.companyName === undefined) !== (params.roleTitle === undefined)) {
      throw invalidRequest('Pass companyName and roleTitle together.');
    }
    if (params.jobId === undefined && !named) throw invalidRequest('Pass jobId, or companyName and roleTitle.');

    // Never add a second entry for a job, or for a company and role, that is already on the board.
    // The route's own create key replays only an identical earlier create, so both checks run
    // against the board first.
    const already = (matches) => ({
      created: false, reason: 'already_tracked', application: compactTrackerApplication(matches[0]), matches: matches.map(compactTrackerApplication),
    });
    if (params.jobId !== undefined) {
      const linked = await linkedEntries(params.jobId);
      if (linked.length > 0) return already(linked);
    }

    let companyName = params.companyName?.trim();
    let roleTitle = params.roleTitle?.trim();
    let location;
    let link = params.link;
    // The route accepts a jobPostingId only for a job it can find; a job that is gone falls back to an unlinked entry.
    let linkedJobId = params.jobId;
    if (params.jobId !== undefined) {
      // The job supplies location and the default link; companyName and roleTitle, when given,
      // override its names. undefined: the job could not be read now; null: the job is gone.
      let found;
      try {
        found = await fetchJob(params.jobId);
      } catch (caught) {
        // With names given the job only adds location and a default link; the create route checks the link itself.
        if (!named) throw caught;
      }
      if (found === null) {
        if (!named) throw notFound(`Trackly job ${params.jobId} was not found. Nothing was written. Pass companyName and roleTitle instead.`);
        linkedJobId = undefined;
      }
      if (!named) {
        companyName = typeof found?.companyName === 'string' ? found.companyName.trim().slice(0, NAME_MAX) : '';
        roleTitle = typeof found?.title === 'string' ? found.title.trim().slice(0, NAME_MAX) : '';
        if (!companyName || !roleTitle) {
          throw invalidRequest(`Trackly job ${params.jobId} has no company or title. Nothing was written. Pass companyName and roleTitle.`);
        }
      }
      if (typeof found?.location === 'string' && found.location.trim()) location = found.location.trim().slice(0, NAME_MAX);
      if (link === undefined && typeof found?.jobUrl === 'string' && /^https?:\/\//i.test(found.jobUrl) && found.jobUrl.length <= LINK_MAX) {
        link = found.jobUrl;
      }
    }

    // Same company and role: with a jobId only an unlinked entry (or one on this job) counts, since
    // another posting can share a title; without a jobId any entry counts.
    const twinsOf = (page) => page.filter(sameRole(companyName, roleTitle))
      .filter((a) => linkedJobId === undefined || a.jobPostingId === null || a.jobPostingId === linkedJobId);
    const twins = twinsOf(await nameCandidates(companyName, roleTitle));
    if (twins.length > 0) return already(twins);

    const body = {
      companyName, roleTitle,
      ...(linkedJobId !== undefined ? { jobPostingId: linkedJobId } : {}),
      ...(location ? { location } : {}),
      ...(link ? { link } : {}),
      ...(params.appliedOn ? { appliedAt: params.appliedOn, appliedAtPrecision: 'local_date', appliedAtTz: TRACKER_DEFAULT_TZ } : {}),
      idempotencyKey: trackerCreateKey({ jobId: linkedJobId, companyName, roleTitle }),
    };
    let createdApp;
    try {
      createdApp = applicationOf(await requestApi('POST', TRACKER_APPLICATIONS_PATH, body));
    } catch (caught) {
      if (caught instanceof TrackerToolError) throw caught;
      const error = apiError(caught);
      // The create route has no 404 of its own: a 404 is the feature gate.
      if (error.status === 404) throw unavailable();
      if (error.status === 422) throw keyReused();
      if (error.status === 400) throw invalidRequest('The Tracker rejected the new entry (check jobId, names, link and appliedOn). Nothing was written.');
      throw caught;
    }
    // The route replays an earlier identical create even when that entry was merged into another
    // one since; the entry to work with is the survivor, and nothing new was created.
    if (createdApp.mergedIntoId != null) return already([(await readDetail(createdApp.mergedIntoId)).application]);
    // The route serializes only identical create keys, so a concurrent create with other input (by
    // job and by name) can still add a twin. Look once more and report one rather than delete
    // anything. The entry exists whatever this look-up does, so its failure never turns the result
    // into an error.
    let others = [];
    let duplicateCheck = 'done';
    try {
      others = [
        ...(linkedJobId !== undefined ? await linkedEntries(linkedJobId) : []),
        ...twinsOf(await nameCandidates(companyName, roleTitle)),
      ].filter((a, i, all) => a.id !== createdApp.id && all.findIndex((b) => b.id === a.id) === i);
    } catch {
      duplicateCheck = 'unavailable';
    }
    return {
      created: true,
      application: compactTrackerApplication(createdApp),
      ...(others.length > 0 ? {
        possibleDuplicates: others.map(compactTrackerApplication),
        hint: 'Another entry for this job or company and role appeared while this one was created. Ask the user whether to merge them on /tracker.',
      } : {}),
      ...(duplicateCheck === 'unavailable' ? {
        duplicateCheck,
        hint: 'The entry was created. The follow-up check for a duplicate created at the same moment could not run; check /tracker if another agent was adding the same job.',
      } : {}),
    };
  }

  async function updateStage(params) {
    const now = new Date();
    const { app, events: known } = await resolveWithEvents(params.applicationId, params.jobId);
    if (app.mergedIntoId != null) throw merged(app);
    const when = whenFields(params.occurredOn);

    let stageResult = null;
    let recorded;
    if (app.currentStage !== params.stage) {
      // A new event that the entry's later stage changes would outrank changes nothing current. When
      // the same stage is already recorded for the same day, report that copy instead of adding
      // another; a new event that would become current (a redo, or a same-day correction) is always written.
      const events = known ?? (await readDetail(app.id)).events;
      if (!wouldBecomeCurrent(events, params.stage, app.currentStage, params.occurredOn, now)) {
        const day = params.occurredOn ?? todayInTrackerZone(now);
        recorded = events.find((e) => e.effective && e.kind === 'stage_change' && e.toStage === params.stage && eventDay(e, events) === day);
      }
    }
    if (app.currentStage !== params.stage && recorded === undefined) {
      // Computed once from the read version, so the retry inside postWithRetry reuses it.
      const idempotencyKey = trackerStageKey(app.id, app.version, params.stage, params.occurredOn, now);
      stageResult = await postWithRetry(
        app, eventsPath,
        (expectedVersion) => ({ kind: 'stage_change', toStage: params.stage, expectedVersion, ...when, payload: {}, idempotencyKey }),
        (fresh) => fresh.currentStage !== params.stage,
        noEntryHint,
      );
    }
    let latest = stageResult?.application ?? app;

    let noteEventId = null;
    let noteOutcome = {};
    if (params.note !== undefined) {
      try {
        // The stage write adds no note, so the events read before it still describe the entry's notes.
        const noteResult = await postNote(latest, params.note, params.occurredOn, now, known);
        latest = noteResult.application;
        noteEventId = noteResult.event?.id ?? null;
        noteOutcome = noteResult.edited
          ? { noteSaved: false, noteError: 'note_edited_since', noteHint: NOTE_EDITED_HINT }
          : noteResult.event?.effective === false
            ? { noteSaved: false, noteError: 'replayed_retracted_note', noteHint: 'The same note was added and retracted earlier today. Nothing new was written; add it again with a different occurredOn if the user wants it back.' }
            : { noteSaved: true };
      } catch (caught) {
        // Nothing from this call was committed yet: a plain error, nothing written.
        if (!stageResult) throw caught;
        // Two events cannot share one transaction through the HTTP API. The stage change is
        // committed, so this is a success for the stage that says the note was not saved; never a
        // full failure.
        noteOutcome = {
          noteSaved: false,
          noteError: noteErrorCode(caught),
          noteHint: 'The stage change was recorded but the note was not. Add the note with trackly_add_tracker_note; repeating this call is also safe.',
        };
      }
    }

    const changed = stageResult !== null && latest.currentStage === params.stage;
    return {
      application: compactTrackerApplication(latest),
      changed,
      ...(stageResult === null && recorded === undefined ? { reason: 'already_in_stage' } : {}),
      ...(recorded !== undefined ? {
        reason: 'already_recorded',
        hint: `A ${params.stage} event for ${params.occurredOn ?? 'today'} is already on this entry, and a stage change that the Tracker orders after it keeps the entry in ${latest.currentStage}. Nothing new was written for the stage; do not repeat this call.`,
      } : {}),
      ...(stageResult !== null && !changed ? stageNotCurrent(stageResult.event, latest, params.stage) : {}),
      stageEventId: stageResult?.event?.id ?? recorded?.id ?? null,
      noteEventId,
      ...noteOutcome,
    };
  }

  async function addNote(params) {
    const now = new Date();
    const { app, events: known } = await resolveWithEvents(params.applicationId, params.jobId);
    if (app.mergedIntoId != null) throw merged(app);
    const result = await postNote(app, params.text, params.occurredOn, now, known);
    if (result.edited) {
      return {
        application: compactTrackerApplication(result.application), noteEventId: result.event?.id ?? null, noteSaved: false,
        reason: 'note_edited_since', hint: NOTE_EDITED_HINT,
      };
    }
    if (result.event?.effective === false) {
      throw new TrackerToolError(409, {
        error: 'replayed_retracted_note',
        ...conflictDetails(result.application),
        hint: 'The same note was added and retracted earlier today, and re-adding it replayed the retracted copy. Nothing new was written. Pass a different occurredOn to add it again.',
      });
    }
    return { application: compactTrackerApplication(result.application), noteEventId: result.event?.id ?? null, noteSaved: true };
  }

  async function retract(params) {
    const app = await writable(params.applicationId, params.jobId);
    // The route answers an already retracted event with 200 and no new row, so a retry is always safe.
    const result = await postWithRetry(
      app,
      (id) => `${eventsPath(id)}/${params.eventId}/retract`,
      (expectedVersion) => ({ expectedVersion }),
      () => true,
      (id) => `No event ${params.eventId} on Tracker entry ${id}. Nothing was written. List its events with trackly_list_tracker_applications and applicationId.`,
    );
    return { application: compactTrackerApplication(result.application), retractedEventId: params.eventId };
  }

  return { list, create, updateStage, addNote, retract };
}

module.exports = {
  TRACKER_APPLICATIONS_PATH,
  TRACKER_DEFAULT_TZ,
  TRACKER_NOTE_MAX,
  TrackerToolError,
  compactTrackerApplication,
  compactTrackerEvent,
  createTrackerToolHandlers,
  trackerCreateKey,
  trackerCreateShape,
  trackerListShape,
  trackerNoteKey,
  trackerNoteShape,
  trackerRetractShape,
  trackerStageKey,
  trackerStageShape,
};
