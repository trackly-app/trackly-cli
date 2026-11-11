'use strict';

// The ported Tracker reducer (mcp/waypoint-reducer.js). The golden vectors in
// test/fixtures/tracker/waypoint-reducer-golden-6cd11dfb.json were produced by close-ai's own
// reducer (src/services/waypoint/reducer.ts at 6cd11dfb) and date-fns-tz 3.2.0 with
// scripts/generate-waypoint-reducer-golden.js, so the port is checked against an independent
// oracle rather than against itself. Regenerate them when the backend reducer changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fromZonedTime, formatDateInZone, isDate, validZone, reduceStage } = require('../mcp/waypoint-reducer');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tracker', 'waypoint-reducer-golden-6cd11dfb.json'), 'utf8'));

test('golden vectors from close-ai\'s reducer: stage, entered-at and effective events match', () => {
  assert.ok(GOLDEN.cases.length >= 200);
  const date = (v) => (v === null ? null : v === 'invalid' ? new Date(Number.NaN) : new Date(v));
  GOLDEN.cases.forEach(({ events, expected }, index) => {
    const rows = events.map((e) => ({
      ...e, applicationId: 1, userId: 7, lineageClass: 'C', idempotencyKey: null,
      createdAt: new Date('2026-03-07T00:00:00.000Z'), occurredAt: date(e.occurredAt), observedAt: date(e.observedAt),
    }));
    assert.deepEqual(reduceStage(rows), expected, `golden case ${index}`);
  });
  // Shuffled input gives the same answer: ordering comes from the events, not the array.
  for (const { events, expected } of GOLDEN.cases.slice(0, 40)) {
    const rows = events.map((e) => ({
      ...e, applicationId: 1, userId: 7, lineageClass: 'C', idempotencyKey: null,
      createdAt: new Date('2026-03-07T00:00:00.000Z'), occurredAt: date(e.occurredAt), observedAt: date(e.observedAt),
    })).reverse();
    assert.equal(reduceStage(rows).currentStage, expected.currentStage);
  }
});

test('golden zone conversions from date-fns-tz, including DST gaps and overlaps', () => {
  for (const { wall, zone, instant } of GOLDEN.zones) {
    assert.equal(fromZonedTime(wall, zone).toISOString(), instant, `${wall} ${zone}`);
  }
});

test('zone helpers match date-fns-tz on DST boundaries', () => {
  // Los Angeles midnight in standard and daylight time, and the days the clocks change.
  assert.equal(fromZonedTime('2026-11-09T00:00:00', 'America/Los_Angeles').toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(fromZonedTime('2026-07-01T00:00:00', 'America/Los_Angeles').toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(fromZonedTime('2026-03-08T23:59:59.999', 'America/Los_Angeles').toISOString(), '2026-03-09T06:59:59.999Z');
  assert.equal(fromZonedTime('2026-11-01T00:00:00', 'America/Los_Angeles').toISOString(), '2026-11-01T07:00:00.000Z');
  // A wall-clock time inside the spring-forward gap resolves as date-fns-tz resolves it.
  assert.equal(fromZonedTime('2026-03-08T02:30:00', 'America/Los_Angeles').toISOString(), '2026-03-08T09:30:00.000Z');
  assert.equal(fromZonedTime('2026-11-09T00:00:00', 'Asia/Kolkata').toISOString(), '2026-11-08T18:30:00.000Z');
  assert.ok(Number.isNaN(fromZonedTime('2026-11-09T00:00:00', 'Mars/Base').getTime()));
  assert.ok(Number.isNaN(fromZonedTime('2026-11-09', 'UTC').getTime()));

  assert.equal(formatDateInZone(new Date('2026-11-10T07:59:59.999Z'), 'America/Los_Angeles'), '2026-11-09');
  assert.equal(formatDateInZone(new Date('2026-11-10T08:00:00.000Z'), 'America/Los_Angeles'), '2026-11-10');
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2028-02-29'), true);
  assert.equal(validZone('Etc/Unknown'), false);
  assert.equal(validZone('America/Los_Angeles'), true);
});

const at = (iso) => new Date(iso);
function row(overrides) {
  return {
    id: 1, applicationId: 1, userId: 1, kind: 'stage_change', fromStage: null, toStage: 'applied', occurredAt: null,
    occurredPrecision: null, occurredTz: null, observedAt: at('2026-11-01T17:00:00Z'), actor: 'user', status: 'confirmed',
    lineageClass: 'C', payload: {}, supersedesEventId: null, retractsEventId: null, idempotencyKey: null, createdAt: at('2026-11-01T17:00:00Z'),
    ...overrides,
  };
}
const localDate = (day) => ({ occurredAt: fromZonedTime(`${day}T00:00:00`, 'America/Los_Angeles'), occurredPrecision: 'local_date', occurredTz: 'America/Los_Angeles' });

test('the stage walk: rank moves forward, only a user drag moves back', () => {
  const applied = row({ id: 1 });
  // A system or undragged event never moves the entry backwards.
  assert.equal(reduceStage([applied, row({ id: 2, toStage: 'interview', observedAt: at('2026-11-02T17:00:00Z') }),
    row({ id: 3, toStage: 'screen', actor: 'system', fromStage: 'interview', observedAt: at('2026-11-03T17:00:00Z') })]).currentStage, 'interview');
  // A user drag (fromStage set) can move back.
  assert.equal(reduceStage([applied, row({ id: 2, toStage: 'interview', observedAt: at('2026-11-02T17:00:00Z') }),
    row({ id: 3, toStage: 'screen', fromStage: 'interview', observedAt: at('2026-11-03T17:00:00Z') })]).currentStage, 'screen');
  // Terminal stages share the top rank.
  assert.equal(reduceStage([applied, row({ id: 2, toStage: 'rejected', observedAt: at('2026-11-02T17:00:00Z') }),
    row({ id: 3, toStage: 'withdrawn', observedAt: at('2026-11-03T17:00:00Z') })]).currentStage, 'rejected');
});

test('a local date sorts at the end of that day, so it outranks an undated event observed earlier that day', () => {
  const result = reduceStage([
    row({ id: 1 }),
    row({ id: 2, toStage: 'interview', fromStage: 'applied', ...localDate('2026-11-09') }),
    row({ id: 3, toStage: 'rejected', fromStage: 'applied', observedAt: at('2026-11-09T20:00:00Z') }),
  ]);
  assert.equal(result.currentStage, 'interview');
  assert.equal(result.stageEnteredAt, '2026-11-10T07:59:59.999Z');
});

test('retractions, corrections, unparseable payloads and suggestions do not count', () => {
  const base = [row({ id: 1 }), row({ id: 2, toStage: 'rejected', observedAt: at('2026-11-02T17:00:00Z') })];
  assert.equal(reduceStage([...base, row({ id: 3, toStage: null, retractsEventId: 2, observedAt: at('2026-11-03T17:00:00Z') })]).currentStage, 'applied');
  assert.equal(reduceStage([...base, row({ id: 3, toStage: 'offer', supersedesEventId: 2, observedAt: at('2026-11-03T17:00:00Z') })]).currentStage, 'offer');
  assert.deepEqual(reduceStage([...base, row({ id: 3, toStage: 'offer', supersedesEventId: 2 })]).effectiveEventIds, [1, 3]);
  assert.equal(reduceStage([row({ id: 1 }), row({ id: 2, toStage: 'rejected', payload: { contactEmail: 'not-an-email' } })]).currentStage, 'applied');
  assert.equal(reduceStage([row({ id: 1 }), row({ id: 2, toStage: 'rejected', status: 'suggested' })]).currentStage, 'applied');
  assert.equal(reduceStage([row({ id: 1 }), row({ id: 2, kind: 'company_contact', toStage: 'screen', payload: { contactType: 'reply' }, observedAt: at('2026-11-02T17:00:00Z') })]).currentStage, 'screen');
  assert.equal(reduceStage([]).currentStage, null);
});
