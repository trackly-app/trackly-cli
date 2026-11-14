#!/usr/bin/env node
'use strict';

// Maintainer script: regenerate test/fixtures/tracker/waypoint-reducer-golden-<sha>.json from the
// backend's own Waypoint reducer, so test/waypoint-reducer.test.js checks mcp/waypoint-reducer.js
// against an independent oracle. Not part of the published package or CI.
//
// 1. In a scratch directory: npm i zod@3.25.76 date-fns@4.1.0 date-fns-tz@3.2.0 esbuild
// 2. Copy src/services/waypoint/{reducer,payload-schema,types}.ts from a close-ai checkout at the
//    target commit into src/, then bundle:
//    npx esbuild src/reducer.ts --bundle --platform=node --format=cjs --outfile=real-reducer.js \
//      --external:zod --external:date-fns-tz --external:date-fns
// 3. TZ=UTC node scripts/generate-waypoint-reducer-golden.js <scratch>/real-reducer.js \
//      <scratch>/node_modules/date-fns-tz 200 test/fixtures/tracker/waypoint-reducer-golden-<sha>.json
//    and update the `source` line below plus the fixture name in the test.
const fs = require('node:fs');
const [realPath, dfntzPath, casesArg, outPath] = process.argv.slice(2);
const real = require(realPath);
const dfntz = require(dfntzPath);
const CASES = Number(casesArg || 250);
let seed = 20261110;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const STAGES = ['contacted', 'saved', 'applied', 'screen', 'assessment', 'interview', 'final', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn'];
const ZONES = ['America/Los_Angeles', 'UTC', 'Europe/London', 'Asia/Kolkata', 'Pacific/Chatham', 'Mars/Base', null];
const DAYS = ['2026-03-07', '2026-03-08', '2026-11-01', '2026-11-02', '2026-10-31', '2026-11-09', '2026-11-10'];
const base = Date.parse('2026-03-07T00:00:00Z');
const valid = (z) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };
const payloads = {
  stage_change: () => pick([{}, {}, {}, { contactEmail: 'a@b.co' }, { contactEmail: 'not-an-email' }]),
  company_contact: () => pick([{ contactType: 'reply' }, { contactType: 'acknowledgement' }, { contactType: 'bogus' }]),
  note: () => pick([{ text: 'hello' }, { text: '' }]),
  deadline: () => ({ dueAt: '2026-11-12', precision: 'local_date', deadlineKind: 'offer' }),
};
const ser = (d) => (d === null ? null : Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString());
const cases = [];
for (let t = 0; t < CASES; t += 1) {
  const n = 1 + Math.floor(rnd() * 8);
  const events = [];
  for (let i = 0; i < n; i += 1) {
    const id = 100 + i * (1 + Math.floor(rnd() * 3));
    const kind = pick(['stage_change', 'stage_change', 'stage_change', 'company_contact', 'note', 'deadline']);
    const prec = pick([null, null, 'local_date', 'local_date', 'instant']);
    const zone = pick(ZONES);
    let occurredAt = null;
    if (prec === 'local_date') occurredAt = dfntz.fromZonedTime(`${pick(DAYS)}T00:00:00`, zone && valid(zone) ? zone : 'UTC');
    else if (prec) occurredAt = new Date(base + Math.floor(rnd() * 250 * 86400000));
    events.push({
      id, applicationId: 1, userId: 7, kind,
      fromStage: rnd() < 0.4 ? pick(STAGES) : null,
      toStage: kind === 'stage_change' || kind === 'company_contact' ? (rnd() < 0.85 ? pick(STAGES) : null) : null,
      occurredAt, occurredPrecision: prec, occurredTz: prec ? zone : null,
      observedAt: new Date(base + Math.floor(rnd() * 250 * 86400000)),
      actor: rnd() < 0.8 ? 'user' : 'system', status: pick(['confirmed', 'confirmed', 'auto', 'suggested']),
      lineageClass: 'C', payload: payloads[kind](),
      supersedesEventId: rnd() < 0.15 && events.length ? pick(events).id : null,
      retractsEventId: rnd() < 0.12 && events.length ? pick(events).id : null,
      idempotencyKey: null, createdAt: new Date(base),
    });
  }
  const r = real.reduceApplication({}, events, new Date(base + 300 * 86400000));
  cases.push({
    events: events.map(({ applicationId: _a, userId: _u, lineageClass: _l, idempotencyKey: _i, createdAt: _c, ...e }) => ({ ...e, occurredAt: ser(e.occurredAt), observedAt: ser(e.observedAt) })),
    expected: { currentStage: r.currentStage, stageEnteredAt: r.stageEnteredAt, effectiveEventIds: r.effectiveEventIds },
  });
}
const zones = [];
for (const zone of ['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Chatham', 'Europe/London']) {
  for (const day of DAYS) {
    for (const time of ['00:00:00', '23:59:59.999', '02:30:00', '01:30:00']) {
      zones.push({ wall: `${day}T${time}`, zone, instant: dfntz.fromZonedTime(`${day}T${time}`, zone).toISOString() });
    }
  }
}
fs.writeFileSync(outPath, `${JSON.stringify({
  note: 'Omitted per event: applicationId 1, userId 7, lineageClass C, idempotencyKey null, createdAt 2026-03-07T00:00:00.000Z.',
  source: 'close-ai src/services/waypoint/reducer.ts at 6cd11dfb1c5b59dbb11b325c3a4f68a1a3fc8b23, date-fns-tz 3.2.0, zod 3.25.76, system TZ=UTC',
  cases, zones,
})}\n`);
console.log(`wrote ${cases.length} cases, ${zones.length} zone conversions; non-null stages: ${cases.filter((c) => c.expected.currentStage).length}`);
