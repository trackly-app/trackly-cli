'use strict';

// Daily recommendation picks, read from GET /api/jobscout/digest.
//
// Contract mirrors the backend (close-ai src/services/recommendation-adapter/
// render.ts) and the web Inbox (TracklyWeb normalize-recommendations.ts and
// recommendation-date.ts). Rules enforced here, shared by the CLI command and
// the MCP tool:
//   - Output is built from an explicit allowlist, so a `score` (or any other
//     field) the server sends can never reach a terminal or an agent.
//   - Only a `delivered` batch dated today in America/Los_Angeles yields picks.
//   - Every other outcome becomes neutral copy that never blames the user, and
//     `failed` never reads as success. The raw status is always kept.
//   - A missing `recommendations` block means the account is not in the pilot.

const { createTracklyAccessError, maintenanceOutput } = require('./client');

const PILOT_TIME_ZONE = 'America/Los_Angeles';
const DIGEST_PATH = '/api/jobscout/digest';
const MAX_PICKS = 5;
const MAX_EXPLANATION_CHARS = 1000;
const MAX_GAP_CHARS = 300;
const MAX_GAPS = 10;

const STATUSES = ['delivered', 'zero_match', 'insufficient_context', 'failed', 'absent', 'unavailable'];

const NOT_ENABLED_MESSAGE = 'Recommendations are not enabled for this account.';
const UNAVAILABLE_MESSAGE = "Recommendations couldn't be loaded right now. Try again later.";
const RETRYABLE_MESSAGE = 'Recommendations are temporarily unavailable. This is retryable: try again in a few minutes.';

function pilotTodayKey(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PILOT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseBatchDate(date) {
  const match = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const exact = parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
  return exact ? parsed : null;
}

function isTodaysBatch(date, now = new Date()) {
  return parseBatchDate(date) !== null && date === pilotTodayKey(now);
}

function formatBatchDate(date, now = new Date()) {
  const parsed = parseBatchDate(date);
  if (!parsed) return null;
  const sameYear = pilotTodayKey(now).slice(0, 4) === String(parsed.getUTCFullYear());
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  // Strip control characters so server text cannot inject terminal escapes.
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  if (text === '') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function positiveInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Normalize the raw `recommendations` block. Returns undefined only when the
// key is absent (account outside the pilot). Anything unusable becomes
// `unavailable`, so a malformed payload never reads as "nothing good today".
function normalizeRecommendations(raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { date: null, status: 'unavailable', picks: [] };
  }
  const status = STATUSES.includes(raw.status) ? raw.status : 'unavailable';
  const seen = new Set();
  const picks = [];
  for (const entry of Array.isArray(raw.picks) ? raw.picks : []) {
    if (!entry || typeof entry !== 'object') continue;
    // The server sends `jobId`; accept a hydrated `job.id` as well.
    const jobId = positiveInt(entry.jobId) ?? positiveInt(entry.job && entry.job.id);
    if (jobId === null || seen.has(jobId)) continue;
    seen.add(jobId);
    const explanation = cleanText(entry.explanation, MAX_EXPLANATION_CHARS);
    const gaps = Array.isArray(entry.gaps)
      ? entry.gaps.map((gap) => cleanText(gap, MAX_GAP_CHARS)).filter(Boolean).slice(0, MAX_GAPS)
      : [];
    const job = entry.job && typeof entry.job === 'object' ? entry.job : null;
    picks.push({
      jobId,
      explanation,
      gaps: gaps.length > 0 ? gaps : null,
      isStretch: typeof entry.isStretch === 'boolean' ? entry.isStretch : null,
      job: job
        ? {
          title: cleanText(job.title, 300),
          company: cleanText(job.company ?? job.companyName, 300),
          location: cleanText(job.location, 300),
        }
        : null,
    });
  }
  return {
    date: typeof raw.date === 'string' ? raw.date : null,
    status: status === 'delivered' && picks.length === 0 ? 'unavailable' : status,
    picks: status === 'delivered' ? picks : [],
  };
}

function whenLabel(block, now) {
  if (isTodaysBatch(block.date, now)) return { when: 'today', batchDate: null };
  const batchDate = formatBatchDate(block.date, now);
  return batchDate ? { when: 'stale', batchDate } : { when: 'unknown', batchDate: null };
}

// Neutral copy for every state that has no picks to show. Never blames the user.
function noticeFor(block, { when, batchDate }, handledCount, closedCount) {
  switch (block.status) {
    case 'delivered': {
      if (handledCount + closedCount > 0) {
        const subject = when === 'today' ? 'for today' : when === 'stale' ? `from ${batchDate}` : 'in this batch';
        const outcome = closedCount === 0
          ? `You've handled every pick ${subject}.`
          : handledCount === 0
            ? `Every pick ${subject} has closed.`
            : `Every pick ${subject} has closed or been handled.`;
        return when === 'stale' ? `Nothing new today. ${outcome} Today's picks haven't arrived yet.` : `Nothing new today. ${outcome}`;
      }
      if (when === 'stale') return `Nothing new today. The latest picks are from ${batchDate}; today's haven't arrived yet.`;
      if (when === 'unknown') return "We couldn't confirm which day these picks are from, so none are shown.";
      return null;
    }
    case 'zero_match':
      if (when === 'stale') return `Nothing new today. Nothing matched on ${batchDate}, and today's picks haven't arrived yet.`;
      if (when === 'unknown') return UNAVAILABLE_MESSAGE;
      return 'Nothing new today. No roles matched in the latest run, which is a normal quiet day.';
    case 'failed':
      // Must not read as an empty-but-healthy day.
      if (when === 'stale') return `The ${batchDate} recommendations did not run, and today's haven't arrived yet. This is not an empty day; check back later.`;
      if (when === 'unknown') return UNAVAILABLE_MESSAGE;
      return "Today's recommendations did not run, so there is nothing to show yet. This is not an empty day; check back later.";
    case 'insufficient_context':
      return 'Nothing new today. Trackly needs a little more career context before it can recommend roles.';
    case 'absent':
      return 'Nothing new today. No recommendations have been generated yet.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

function notEnabledResult() {
  return {
    enabled: false,
    status: null,
    date: null,
    isToday: false,
    message: NOT_ENABLED_MESSAGE,
    picks: [],
  };
}

function jobDetailFields(detail) {
  const job = detail && typeof detail === 'object' ? (detail.job || detail) : {};
  return {
    title: cleanText(job.title, 300),
    company: cleanText(job.companyName ?? (job.company && job.company.name), 300),
    location: cleanText(job.location, 300),
    jobUrl: typeof job.jobUrl === 'string' && /^https?:\/\//i.test(job.jobUrl) ? job.jobUrl : null,
    handled: job.userStatus != null && job.userStatus !== 'new',
    closed: job.isActive === false,
  };
}

function buildPick(pick, fields, lookupFailed = false) {
  const hydrated = fields || {};
  const base = pick.job || {};
  const out = {
    jobId: pick.jobId,
    title: hydrated.title ?? base.title ?? null,
    company: hydrated.company ?? base.company ?? null,
    location: hydrated.location ?? base.location ?? null,
    jobUrl: hydrated.jobUrl ?? null,
  };
  if (lookupFailed && !out.title) out.note = 'Job details could not be loaded; use the jobId to fetch them.';
  if (pick.explanation) out.reason = pick.explanation;
  if (pick.gaps) out.gaps = pick.gaps;
  if (pick.isStretch !== null) out.isStretch = pick.isStretch;
  return out;
}

// Pure projection of the digest response into the public result. `jobDetails`
// maps jobId to a raw job detail response, or null when it could not be loaded.
function buildRecommendationsResult(digest, { now = new Date(), jobDetails = new Map() } = {}) {
  const block = normalizeRecommendations(digest && typeof digest === 'object' ? digest.recommendations : undefined);
  if (block === undefined) return notEnabledResult();

  const label = whenLabel(block, now);
  const result = {
    enabled: true,
    status: block.status,
    date: block.date,
    isToday: label.when === 'today',
    message: null,
    picks: [],
  };

  let handledCount = 0;
  let closedCount = 0;
  if (block.status === 'delivered' && label.when === 'today') {
    for (const pick of block.picks.slice(0, MAX_PICKS)) {
      const detail = jobDetails.get(pick.jobId);
      const fields = detail ? jobDetailFields(detail) : null;
      if (fields && fields.handled) { handledCount += 1; continue; }
      if (fields && fields.closed) { closedCount += 1; continue; }
      result.picks.push(buildPick(pick, fields, detail === null));
    }
    if (block.picks.length > MAX_PICKS) result.truncated = block.picks.length - MAX_PICKS;
  } else if (block.status === 'delivered') {
    // Delivered but not today's batch: report stale/unknown, never show the picks.
    result.message = noticeFor(block, label, 0, 0);
    return result;
  }
  result.message = result.picks.length === 0 ? noticeFor(block, label, handledCount, closedCount) : null;
  if (handledCount) result.handledCount = handledCount;
  if (closedCount) result.closedCount = closedCount;
  return result;
}

function retryableError(status) {
  return {
    status: status || 503,
    code: 'recommendations_unavailable',
    retryable: true,
    error: RETRYABLE_MESSAGE,
    message: RETRYABLE_MESSAGE,
  };
}

// Map a failed digest request. 403 (not in the inbox beta) is a normal "not
// enabled" answer; 503 and transport failures are retryable. Anything else
// (401, trackly access codes, maintenance) propagates to the caller's handler.
function classifyDigestError(error) {
  // Access and maintenance errors keep their own canonical handling.
  if (error && typeof error === 'object' && !createTracklyAccessError(error, error.status) && !maintenanceOutput(error)) {
    if (error.status === 403) return { kind: 'not_enabled' };
    // 5xx (including digest_unavailable) and transport failures (no HTTP status,
    // e.g. ECONNRESET or a timeout) are transient.
    if (typeof error.status === 'number' && error.status >= 500) {
      return { kind: 'retryable', error: retryableError(error.status) };
    }
    if (error.status === undefined && (error.message || error.error)) {
      return { kind: 'retryable', error: retryableError(503) };
    }
  }
  return { kind: 'other' };
}

// Fetch the digest and resolve today's picks. `request` is apiRequest bound to
// the caller's User-Agent: request(method, path) -> Promise.
async function fetchRecommendations(request, { now = new Date() } = {}) {
  let digest;
  try {
    digest = await request('GET', DIGEST_PATH);
  } catch (error) {
    const classified = classifyDigestError(error);
    if (classified.kind === 'not_enabled') return notEnabledResult();
    if (classified.kind === 'retryable') throw classified.error;
    throw error;
  }

  // Resolve job details only when there are picks that will be shown. A failed
  // lookup leaves the pick id-only so the agent can still chain by jobId.
  const jobDetails = new Map();
  const block = normalizeRecommendations(digest && digest.recommendations);
  if (block && block.status === 'delivered' && isTodaysBatch(block.date, now)) {
    await Promise.all(block.picks.slice(0, MAX_PICKS).map(async (pick) => {
      try {
        jobDetails.set(pick.jobId, await request('GET', `/api/jobscout/jobs/${pick.jobId}`));
      } catch {
        jobDetails.set(pick.jobId, null);
      }
    }));
  }
  return buildRecommendationsResult(digest, { now, jobDetails });
}

module.exports = {
  NOT_ENABLED_MESSAGE,
  buildRecommendationsResult,
  fetchRecommendations,
  formatBatchDate,
  isTodaysBatch,
  normalizeRecommendations,
  pilotTodayKey,
};
