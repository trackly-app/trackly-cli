'use strict';

// Port of the Trackly Tracker (Waypoint) reducer the hosted MCP uses to decide
// whether a stage write would become an entry's current stage (close-ai
// src/services/waypoint/reducer.ts, payload-schema.ts and types.ts at
// 6cd11dfb, PR #3603). The local Tracker tools read events over HTTP and run
// this reducer on them, exactly as the hosted tools run the backend's own.
//
// Only the parts that decide currentStage and event effectiveness are ported:
// payload parsing (an unparseable payload makes an event not count), the
// supersede/anchor ordering, retraction and supersession, and the stage walk.
// The interview, deadline and follow-up projections do not affect the stage
// and stay in the backend. Keep this file in sync with those three sources.

const { z } = require('zod');

const WAYPOINT_STAGES = Object.freeze([
  'contacted', 'saved', 'applied', 'screen', 'assessment', 'interview', 'final', 'offer',
  'accepted', 'declined', 'rejected', 'withdrawn',
]);
const TERMINAL_STAGES = new Set(['accepted', 'declined', 'rejected', 'withdrawn']);
const CONTACT_TYPES = Object.freeze(['acknowledgement', 'reply', 'scheduling', 'rejection', 'offer', 'other']);

// ── Time zone helpers (the two date-fns-tz calls the backend makes) ─────────

/** Whether Intl accepts a zone; Etc/Unknown is refused (payload-schema.ts validZone). */
function validZone(value) {
  if (value === 'Etc/Unknown') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date: it must round-trip, so 2026-02-30 is out (payload-schema.ts isDate). */
function isDate(value) {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const partsFormatters = new Map();
function zoneParts(instantMs, zone) {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', era: 'short',
    });
    partsFormatters.set(zone, formatter);
  }
  const out = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) out[part.type] = part.value;
  let year = Number(out.year);
  if (out.era === 'BC' || out.era === 'B') year = 1 - year;
  return {
    year, month: Number(out.month), day: Number(out.day), hour: Number(out.hour) % 24,
    minute: Number(out.minute), second: Number(out.second),
  };
}

function utcFromFields(year, monthIndex, day, hour, minute, second, ms) {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIndex, day);
  d.setUTCHours(hour, minute, second, ms);
  return d.getTime();
}

/** The zone's offset from UTC at an instant, in ms (date-fns-tz calcOffset). */
function calcOffset(instantMs, zone) {
  const p = zoneParts(instantMs, zone);
  const asUtc = utcFromFields(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  let asTs = instantMs;
  const over = asTs % 1000;
  asTs -= over >= 0 ? over : 1000 + over;
  return asUtc - asTs;
}

/** date-fns-tz fixOffset: settle the offset of a wall-clock time across a DST change. */
function fixOffset(wallAsUtcMs, offset, zone) {
  let utcGuess = wallAsUtcMs - offset;
  const o2 = calcOffset(utcGuess, zone);
  if (offset === o2) return offset;
  utcGuess -= o2 - offset;
  const o3 = calcOffset(utcGuess, zone);
  if (o2 === o3) return o2;
  return Math.max(o2, o3);
}

const LOCAL_WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
/**
 * The instant a wall-clock time in a zone denotes (date-fns-tz fromZonedTime on a
 * zone-less YYYY-MM-DDTHH:mm:ss[.sss] string, as the backend server, which runs
 * in UTC, evaluates it). Returns an Invalid Date for anything else.
 */
function fromZonedTime(localIso, zone) {
  const m = LOCAL_WALL_CLOCK.exec(localIso);
  if (!m || !validZone(zone)) return new Date(Number.NaN);
  const wall = utcFromFields(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]),
    Number((m[7] || '0').padEnd(3, '0')));
  const offset = fixOffset(wall, calcOffset(wall, zone), zone);
  return new Date(wall - offset);
}

/** The YYYY-MM-DD calendar day of an instant in a zone (date-fns-tz formatInTimeZone 'yyyy-MM-dd'). */
function formatDateInZone(date, zone) {
  const p = zoneParts(date.getTime(), zone);
  const year = p.year < 0 ? `-${String(-p.year).padStart(6, '0')}` : String(p.year).padStart(4, '0');
  return `${year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ── Payload read schemas (payload-schema.ts buildPayloadSchemas('read')) ────

const TIME_PART = /^T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?/;
const EXPLICIT_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const zoned = (v) => typeof v === 'string' && isDate(v.slice(0, 10)) && TIME_PART.test(v.slice(10))
  && EXPLICIT_ZONE.test(v) && !Number.isNaN(new Date(v).getTime());
// The backend validates with zod 3's z.string().email(); this is that exact pattern, so a
// payload the backend's reducer reads is read here too, whatever this package's zod version.
const ZOD3_EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

function buildReadPayloadSchemas() {
  const zonedStr = z.string().refine(zoned, 'zoned timestamp');
  const dateStr = z.string().refine(isDate, 'calendar date');
  const zone = z.string().refine(validZone, 'IANA zone');
  const eventRef = z.number().int().positive();
  const contactShape = () => ({
    contactEmail: z.string().regex(ZOD3_EMAIL).max(320).optional(),
    contactName: z.string().max(120).optional(),
  });
  const obj = (shape) => z.object(shape);
  return {
    stage_change: obj(contactShape()),
    company_contact: obj({ ...contactShape(), contactType: z.enum(CONTACT_TYPES) }),
    interview_scheduled: obj({
      startsAt: zonedStr,
      endsAt: zonedStr.optional(),
      tz: zone.optional(),
      kind: z.enum(['screen', 'technical', 'behavioral', 'onsite', 'final', 'other']).optional(),
      format: z.enum(['phone', 'video', 'onsite', 'other']).optional(),
    }).refine((v) => v.endsAt === undefined || new Date(v.endsAt) > new Date(v.startsAt), 'endsAt must follow startsAt'),
    interview_done: obj({ interviewEventId: eventRef }),
    deadline: obj({
      dueAt: z.union([zonedStr, dateStr]),
      precision: z.enum(['instant', 'local_date']),
      tz: zone.optional(),
      deadlineKind: z.enum(['assessment', 'offer', 'other']),
      label: z.string().max(120).optional(),
    }).refine((v) => isDate(v.dueAt) === (v.precision === 'local_date'), 'dueAt shape must agree with precision'),
    note: obj({ ...contactShape(), text: z.string().min(1).max(2000) }),
    follow_up_control: z.discriminatedUnion('control', [
      obj({ control: z.literal('sent'), value: z.enum(['follow_up', 'thank_you', 'status_check', 'extension_request', 'withdrawal', 'accept', 'decline']).optional() }),
      obj({ control: z.literal('not_sent') }),
      obj({ control: z.literal('waiting_until'), value: z.union([dateStr, z.null()]) }),
      obj({ control: z.literal('do_not_follow_up'), value: z.boolean() }),
      obj({ control: z.literal('interview_happened'), value: z.boolean(), interviewEventId: eventRef }),
    ]),
  };
}

const PAYLOAD_SCHEMAS = buildReadPayloadSchemas();

// ── Reducer (reducer.ts) ────────────────────────────────────────────────────

/** 0-7 for contacted..offer; every terminal stage is 8. */
function stageRank(stage) {
  return TERMINAL_STAGES.has(stage) ? 8 : WAYPOINT_STAGES.indexOf(stage);
}

/** A YYYY-MM-DD value is compared as the END of that date in tz (UTC when tz is null or invalid). */
function comparableInstant(at, tz) {
  if (!isDate(at)) return new Date(at);
  if (tz) {
    const d = fromZonedTime(`${at}T23:59:59.999`, tz);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(`${at}T23:59:59.999Z`);
}

// A local_date row stores local midnight of its date in occurredTz (UTC when the zone is null or
// invalid); it sorts at the end of that date in the same zone.
function sortTime(e) {
  if (e.occurredAt == null) return e.observedAt.getTime();
  if (e.occurredPrecision !== 'local_date') return e.occurredAt.getTime();
  const zone = e.occurredTz && validZone(e.occurredTz) ? e.occurredTz : 'UTC';
  return comparableInstant(formatDateInZone(e.occurredAt, zone), zone).getTime();
}

const finiteDate = (d) => d instanceof Date && Number.isFinite(d.getTime());
// manual beats imported, confirmed beats auto
const precedence = (e) => (e.actor === 'user' ? 2 : 0) + (e.status === 'confirmed' ? 1 : 0);
const counts = (e) => e.status === 'confirmed' || e.status === 'auto';

/** Counted events whose payload parses; a failed parse is treated like a dismissed event. */
function liveEvents(events, includeInactive = false) {
  const out = [];
  for (const e of events) {
    if ((!counts(e) && !(includeInactive && (e.status === 'suggested' || e.status === 'dismissed')))
      || !Object.hasOwn(PAYLOAD_SCHEMAS, e.kind)) continue;
    if (!finiteDate(e.observedAt) || (e.occurredAt != null && !finiteDate(e.occurredAt))) continue;
    if (e.retractsEventId != null && e.supersedesEventId == null) { out.push(e); continue; }
    const r = PAYLOAD_SCHEMAS[e.kind].safeParse(e.payload);
    if (r.success) out.push({ ...e, payload: r.data });
  }
  return out;
}

/** Observation identity is not occurrence evidence; resolve correction anchors once per reduction. */
function eventOrdering(events) {
  const countsById = new Map();
  for (const e of events) countsById.set(e.id, (countsById.get(e.id) ?? 0) + 1);
  const byId = new Map(liveEvents(events, true)
    .filter((e) => countsById.get(e.id) === 1 && e.retractsEventId == null).map((e) => [e.id, e]));
  const parentOf = (e) => {
    if (e.supersedesEventId == null || e.retractsEventId != null) return undefined;
    const parent = byId.get(e.supersedesEventId);
    return parent && parent.id < e.id && parent.userId === e.userId
      && parent.applicationId === e.applicationId && parent.kind === e.kind ? parent : undefined;
  };
  const memo = new Map();
  const anchor = (e) => {
    if (!memo.has(e.id)) {
      const path = [];
      const visited = new Set();
      let node = byId.get(e.id);
      let root = null;
      while (node && !visited.has(node.id) && path.length <= byId.size) {
        if (memo.has(node.id)) { root = memo.get(node.id) ?? null; break; }
        path.push(node); visited.add(node.id);
        if (node.supersedesEventId == null) { root = node; break; }
        node = parentOf(node);
      }
      for (const row of path) memo.set(row.id, root);
      if (!memo.has(e.id)) memo.set(e.id, null);
    }
    return memo.get(e.id) ?? e;
  };
  const position = (e) => (e.occurredAt == null ? anchor(e) : e);
  const time = (e) => (e.occurredAt == null ? anchor(e).observedAt.getTime() : sortTime(e));
  return {
    time,
    supersedes: (e) => parentOf(e) !== undefined,
    compare: (a, b) => time(a) - time(b) || precedence(a) - precedence(b)
      || position(a).observedAt.getTime() - position(b).observedAt.getTime()
      || position(a).id - position(b).id || a.id - b.id,
  };
}

function effectiveOf(live, ordering) {
  const retracted = new Set();
  const superseded = new Set();
  for (const e of live) {
    if (e.retractsEventId != null) retracted.add(e.retractsEventId);
    // counted even when the superseder is later retracted: a correction never revives what it replaced
    if (e.supersedesEventId != null && ordering.supersedes(e)) superseded.add(e.supersedesEventId);
  }
  return live
    .filter((e) => e.retractsEventId == null && !retracted.has(e.id) && !superseded.has(e.id))
    .sort(ordering.compare);
}

/**
 * The stage part of reduceApplication: the entry's current stage, when it was entered, and the
 * ids of its effective events, from its stored event rows (Date-valued occurredAt/observedAt).
 */
function reduceStage(events) {
  const live = liveEvents(events);
  const ordering = eventOrdering(events);
  const effective = effectiveOf(live, ordering);
  let current = null;
  let enteredAt = null;
  for (const e of effective) {
    const t = new Date(ordering.time(e));
    if (e.toStage != null && (e.kind === 'stage_change' || e.kind === 'company_contact')) {
      const moves = current === null
        || (e.kind === 'stage_change' && e.actor === 'user' && e.fromStage != null
          ? e.toStage !== current // only a user drag (fromStage set) moves backwards
          : stageRank(e.toStage) > stageRank(current));
      if (moves) { current = e.toStage; enteredAt = t; }
    }
  }
  return {
    currentStage: current,
    stageEnteredAt: enteredAt ? enteredAt.toISOString() : null,
    effectiveEventIds: effective.map((e) => e.id),
  };
}

module.exports = {
  WAYPOINT_STAGES,
  TERMINAL_STAGES,
  isDate,
  validZone,
  fromZonedTime,
  formatDateInZone,
  reduceStage,
  stageRank,
};
