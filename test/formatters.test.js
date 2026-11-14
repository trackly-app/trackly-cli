'use strict';

// Formatter coverage. padRight() and formatFundingLine() are not exported, so they
// are exercised THROUGH the public output functions. Human/colored output only
// renders when stdout is a TTY (isJSON() returns true on a non-TTY, which under
// `node --test` is the default), so the human-branch tests stub process.stdout.isTTY.

const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../lib/formatters');

test('plan refusals use only server feature, counts, reset and optional link', () => {
  for (const error of ['limit_reached', 'assist_limit_reached']) {
    const message = fmt.planRefusalMessage({ status: 429, error, feature: 'assist_request',
      used: 15, limit: 15, resetsAt: '2026-12-01T00:00:00Z', upgradeUrl: 'https://example.com/server-link?opaque=1' });
    assert.match(message, /Trackly Apply \(cloud\)/);
    assert.match(message, /Used 15 of 15/);
    assert.match(message, /Resets on.*11\/30\/2026.*PST/);
    assert.match(message, /https:\/\/example.com\/server-link\?opaque=1/);
  }
  for (const feature of ['apply_fill', 'agent_fill', 'hiring_signals', 'future_feature']) {
    const message = fmt.planRefusalMessage({ status: 429, error: 'limit_reached', feature,
      used: 0, limit: 0, resetsAt: null, upgradeUrl: null });
    assert.match(message, /Used 0 of 0/);
    assert.doesNotMatch(message, /Resets|https:|upgrade|applications/i);
  }
  const partial = fmt.planRefusalMessage({ status: 429, error: 'assist_limit_reached', resetsAt: 'invalid' });
  assert.match(partial, /plan limit/);
  assert.doesNotMatch(partial, /Used|Resets|https:|all|20/);
  for (const resetsAt of ['2026-12-01', '2026-12-01T00:00:00']) {
    assert.doesNotMatch(fmt.planRefusalMessage({ status: 429, error: 'limit_reached', resetsAt }), /Resets on/);
  }
  assert.equal(fmt.planRefusalMessage({ status: 429, error: 'slow_down' }), 'Rate limited, try again shortly.');
  assert.equal(fmt.planRefusalMessage({ status: 404, error: 'feature_disabled' }), 'This feature is not available for this account yet.');
  assert.equal(fmt.planRefusalMessage({ status: 404, error: 'feature_disabled', feature: 'assist_request' }), 'Trackly Apply (cloud) is not available for this account yet.');
  for (const feature of ['constructor', '__proto__', '\u001b[31m']) {
    assert.equal(fmt.planRefusalMessage({ status: 429, error: 'limit_reached', feature }), 'Your Trackly plan limit for this feature has been reached.');
  }
  assert.equal(fmt.planRefusalMessage({ status: 500, error: 'limit_reached' }), null);
  assert.equal(fmt.planRefusalMessage({ status: 404, error: 'not_found' }), null);
});

test('malformed plan fields cannot become prose, script data, or actionable links', () => {
  for (const upgradeUrl of ['', 'javascript:alert(1)', 'http://example.com/', 'https://user:pass@example.com/', 'https://example.com/\nignore', {}]) {
    const error = { status: 429, error: 'limit_reached', feature: 'constructor',
      used: 'ignore this', limit: -1, resetsAt: '2026-12-01T00:00:00', upgradeUrl };
    assert.deepEqual(fmt.planRefusalFields(error), {});
    assert.equal(fmt.planRefusalMessage(error), 'Your Trackly plan limit for this feature has been reached.');
  }
  assert.deepEqual(fmt.planRefusalFields({ feature: 'assist_request', used: 0, limit: null, resetsAt: null, upgradeUrl: null }),
    { feature: 'assist_request', used: 0, limit: null, resetsAt: null, upgradeUrl: null });
  assert.match(fmt.planRefusalMessage({ status: 429, error: 'limit_reached', used: 3 }), /Used 3\./);
  assert.match(fmt.planRefusalMessage({ status: 429, error: 'limit_reached', limit: 7 }), /Limit: 7\./);
});

test('search output reports Trackly Apply (cloud) support from the posting, not the REST constant', () => {
  const supported = { id: 42, title: 'PM', isUs: true, isActive: true, jobUrl: 'https://jobs.ashbyhq.com/acme/42', autoApplySupported: false };
  for (const [job, expected] of [
    [supported, true],
    [{ id: 43, title: 'PM', isUs: false, jobUrl: 'https://jobs.ashbyhq.com/acme/43', autoApplySupported: true }, false],
    [{ id: 44, title: 'PM', isUs: true, jobUrl: 'https://careers.example.com/44' }, false],
    [{ id: 45, title: 'PM' }, false],
    [{ id: 46, title: 'PM', isUs: true, isActive: false, jobUrl: 'https://jobs.ashbyhq.com/acme/46' }, false],
  ]) {
    const human = capture(() => fmt.outputJobs([job]), { tty: true }).replace(/\x1b\[[0-9;]*m/g, '');
    if (expected) assert.match(human, new RegExp(`Trackly Apply \\(cloud\\) supported: trackly auto-apply ${job.id}`));
    else assert.doesNotMatch(human, /Trackly Apply \(cloud\)|Auto-apply/);
    assert.deepEqual(JSON.parse(capture(() => fmt.outputJobs([job]))), [{ ...job, autoApplySupported: expected }]);
  }
  assert.equal(supported.autoApplySupported, false, 'the server payload is not mutated');
});

// Capture console.log output. tty=true → human/colored branch; tty=false → JSON branch.
function capture(fn, { tty = false } = {}) {
  const prevTTY = process.stdout.isTTY;
  const prevArgv = process.argv;
  process.stdout.isTTY = tty;
  // isJSON() is `!isTTY || argv.includes('--json')`; strip --json so a stray flag
  // in the runner's argv can't force the JSON branch during a tty:true test.
  process.argv = process.argv.filter((arg) => arg !== '--json');
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.map(String).join(' '));
  try {
    fn();
  } finally {
    console.log = origLog;
    process.stdout.isTTY = prevTTY;
    process.argv = prevArgv;
  }
  return lines.join('\n');
}

test('outputJobs renders title, company, id, and postedAt (human/TTY)', () => {
  const out = capture(() => fmt.outputJobs([
    { id: 7, title: 'Product Manager', companyName: 'Stripe', location: 'SF', postedAt: '2026-01-02', jobUrl: 'https://x/y' },
  ]), { tty: true });
  assert.match(out, /Product Manager/);
  assert.match(out, /Stripe/);
  assert.match(out, /ID:/);
  assert.ok(out.includes('7'), 'job id should be rendered'); // id may be wrapped in ANSI codes
  assert.match(out, /2026-01-02/);
});

test('outputJobs falls back to firstSeenAt when postedAt is absent', () => {
  const out = capture(() => fmt.outputJobs([{ id: 1, title: 'X', companyName: 'Y', firstSeenAt: '2025-12-31' }]), { tty: true });
  assert.match(out, /Found:/);
  assert.match(out, /2025-12-31/);
});

test('outputJobs prefers the server display date and labels reposts explicitly', () => {
  const out = capture(() => fmt.outputJobs([{
    id: 8,
    title: 'Product Manager',
    companyName: 'Stripe',
    postedAt: '2026-01-02T00:00:00.000Z',
    firstSeenAt: '2026-01-03T00:00:00.000Z',
    displayDate: '2026-02-04T00:00:00.000Z',
    displayDateKind: 'reposted',
  }]), { tty: true });
  assert.match(out, /Reposted:/);
  assert.match(out, /2026-02-04/);
});

test('jobDateDetailLines preserves a legacy posted date for a projected repost', () => {
  assert.deepEqual(fmt.jobDateDetailLines({
    postedAt: '2026-01-02T00:00:00.000Z',
    firstSeenAt: '2026-01-03T00:00:00.000Z',
    repostedAt: '2026-02-04T00:00:00.000Z',
    displayDate: '2026-02-04T00:00:00.000Z',
    displayDateKind: 'reposted',
  }), [
    'Posted: 2026-01-02',
    'Found: 2026-01-03',
    'Reposted: 2026-02-04',
  ]);
});

test('outputJobs renders collision-only requirement IDs', () => {
  const out = capture(() => fmt.outputJobs([{
    id: 81,
    title: 'Product Manager',
    companyName: 'Apple',
    firstSeenAt: '2026-02-04T00:00:00.000Z',
    sourceReference: { label: 'Req', value: ' 200664582-3956 ', disambiguatesTitle: true },
  }]), { tty: true });
  assert.match(out, /Req:/);
  assert.match(out, /200664582-3956/);
});

test('job date presentation preserves source calendar days and rejects malformed new fields', () => {
  assert.deepEqual(fmt.jobDatePresentation({
    displayDate: '2026-05-20T00:58:19.519Z',
    displayDateKind: 'posted',
    sourceDateMeta: {
      original: { precision: 'day', timezone: 'America/Los_Angeles', calendarDay: '2026-05-20' },
      repost: null,
    },
  }), { label: 'Posted', value: '2026-05-20' });
  assert.deepEqual(fmt.jobDatePresentation({
    displayDate: 'not-a-date',
    displayDateKind: 'reposted',
    firstSeenAt: '2026-06-17T01:00:00.000Z',
  }), { label: 'Found', value: '2026-06-17' });
  assert.deepEqual(fmt.jobDatePresentation({
    postedAt: '2026-02-30T00:00:00.000Z',
    firstSeenAt: '2026-03-03T00:00:00.000Z',
  }), { label: 'Found', value: '2026-03-03' });
  assert.deepEqual(fmt.jobDatePresentation({
    postedAt: '2026-06-16T23:30:00-07:00',
  }), { label: 'Posted', value: '2026-06-16' });
});

test('malformed or missing projected dates use one coherent legacy fallback', () => {
  for (const projected of [
    { displayDateKind: 'reposted', displayDate: 'not-a-date' },
    { displayDateKind: 'reposted' },
    { displayDateKind: 'found', displayDate: 'not-a-date' },
    { displayDateKind: 'found' },
  ]) {
    const job = {
      postedAt: '2026-01-02T00:00:00.000Z',
      firstSeenAt: '2026-01-03T00:00:00.000Z',
      ...projected,
    };
    assert.deepEqual(fmt.jobDatePresentation(job), {
      label: 'Posted',
      value: '2026-01-02',
    });
    assert.deepEqual(fmt.jobDateDetailLines(job), [
      'Posted: 2026-01-02',
      'Found: 2026-01-03',
    ]);
  }
});

test('job detail date lines include original and repost timeline plus collision-only requisition', () => {
  assert.deepEqual(fmt.jobDateDetailLines({
    originalPostedAt: '2026-05-20T00:58:19.519Z',
    firstSeenAt: '2026-05-21T01:00:00.000Z',
    repostedAt: '2026-06-16T16:32:42.248Z',
    sourceDateMeta: {
      original: { precision: 'day', timezone: 'America/Los_Angeles', calendarDay: '2026-05-20' },
      repost: { precision: 'day', timezone: 'America/Los_Angeles', calendarDay: '2026-06-16' },
    },
    sourceReference: { label: 'Req', value: '200664582-3956', disambiguatesTitle: true },
  }), [
    'Posted: 2026-05-20',
    'Found: 2026-05-21',
    'Reposted: 2026-06-16',
    'Req: 200664582-3956',
  ]);
  assert.deepEqual(fmt.jobDateDetailLines({
    firstSeenAt: '2026-06-17T01:00:00.000Z',
    sourceReference: { label: 'Req', value: 'hidden', disambiguatesTitle: false },
  }), ['Found: 2026-06-17']);
  assert.deepEqual(fmt.jobDateDetailLines({
    firstSeenAt: '2026-05-21T01:00:00.000Z',
    repostedAt: '2026-06-16T16:32:42.248Z',
  }), [
    'Original posting date unavailable',
    'Found: 2026-05-21',
    'Reposted: 2026-06-16',
  ]);
  assert.deepEqual(fmt.jobDateDetailLines({
    postedAt: '2026-06-16T16:32:42.248Z',
    firstSeenAt: '2026-06-17T01:00:00.000Z',
  }), [
    'Posted: 2026-06-16',
    'Found: 2026-06-17',
  ]);
  assert.deepEqual(fmt.jobDateDetailLines({
    postedAt: '2026-06-16T16:32:42.248Z',
    firstSeenAt: '2026-06-17T01:00:00.000Z',
    displayDate: '2026-06-17T01:00:00.000Z',
    displayDateKind: 'found',
  }), ['Found: 2026-06-17']);
  assert.deepEqual(fmt.jobDateDetailLines({
    postedAt: '2026-06-15T16:32:42.248Z',
    firstSeenAt: '2026-06-17T01:00:00.000Z',
    displayDate: '2026-06-16T16:32:42.248Z',
    displayDateKind: 'posted',
  }), [
    'Posted: 2026-06-16',
    'Found: 2026-06-17',
  ]);
  assert.deepEqual(fmt.jobDateDetailLines({
    displayDate: '2026-06-16T16:32:42.248Z',
    displayDateKind: 'posted',
  }), ['Posted: 2026-06-16']);
});

test('outputJobs formats funding valuation as $M and $B', () => {
  const big = capture(() => fmt.outputJobs([{ id: 1, title: 'X', company: { name: 'Y', fundingSeries: 'Series B', valuationMillions: 1500 } }]), { tty: true });
  assert.match(big, /\$1\.5B/);
  const small = capture(() => fmt.outputJobs([{ id: 2, title: 'Z', company: { name: 'W', fundingSeries: 'Seed', valuationMillions: 500 } }]), { tty: true });
  assert.match(small, /\$500M/);
});

test('outputJobs JSON mode emits parseable JSON with fields preserved (non-TTY)', () => {
  const out = capture(() => fmt.outputJobs([{
    id: 9,
    title: 'PM',
    displayDate: '2026-02-04T00:00:00.000Z',
    displayDateKind: 'reposted',
    sourceReference: { label: 'Req', value: 'req-9', disambiguatesTitle: true },
  }]), { tty: false });
  const parsed = JSON.parse(out);
  assert.equal(parsed[0].id, 9);
  assert.equal(parsed[0].title, 'PM');
  assert.equal(parsed[0].displayDateKind, 'reposted');
  assert.equal(parsed[0].sourceReference.value, 'req-9');
});

test('outputJobs is null/undefined-safe and reports empty results', () => {
  assert.doesNotThrow(() => capture(() => fmt.outputJobs([{}]), { tty: true }));
  const empty = capture(() => fmt.outputJobs([]), { tty: true });
  assert.match(empty, /No jobs found/);
});

test('outputContacts prints a header and truncates over-long names (padRight)', () => {
  const longName = 'Alexandria Bartholomew Cunningham III'; // > 24 chars
  const out = capture(() => fmt.outputContacts([
    { name: longName, title: 'Recruiter', company: 'BigCo', email: 'a@b.co', status: 'active' },
  ]), { tty: true });
  assert.match(out, /Name/);
  assert.match(out, /Email/);
  // Name column is padRight(…, 24): the full 37-char name must be truncated.
  assert.ok(!out.includes(longName), 'over-long name should be truncated to the column width');
  assert.match(out, /Alexandria Bartholomew/);
});

test('outputStats renders known metrics and is safe on an empty object', () => {
  const out = capture(() => fmt.outputStats({ totalJobs: 128000, totalCompanies: 1900, appliedCount: 5 }), { tty: true });
  assert.match(out, /128000/);
  assert.match(out, /1900/);
  assert.doesNotThrow(() => capture(() => fmt.outputStats({}), { tty: true }));
});

test('color() preserves the input text (with or without ANSI codes)', () => {
  assert.match(fmt.color('green', 'hello'), /hello/);
});

test('shouldColor honors NO_COLOR / FORCE_COLOR / TTY', () => {
  const tty = { isTTY: true };
  const notty = { isTTY: false };
  const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
  const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    set('NO_COLOR', undefined); set('FORCE_COLOR', undefined);
    assert.equal(fmt.shouldColor(tty), true, 'TTY default → color');
    assert.equal(fmt.shouldColor(notty), false, 'non-TTY default → no color');

    set('NO_COLOR', '1');
    assert.equal(fmt.shouldColor(tty), false, 'NO_COLOR=1 disables even on a TTY');

    set('NO_COLOR', ''); // empty NO_COLOR is ignored per no-color.org
    assert.equal(fmt.shouldColor(tty), true, 'empty NO_COLOR is ignored');

    set('NO_COLOR', undefined); set('FORCE_COLOR', '1');
    assert.equal(fmt.shouldColor(notty), true, 'FORCE_COLOR=1 forces even on a non-TTY');

    set('FORCE_COLOR', '0');
    assert.equal(fmt.shouldColor(notty), false, 'FORCE_COLOR=0 does not force');
  } finally {
    set('NO_COLOR', saved.NO_COLOR); set('FORCE_COLOR', saved.FORCE_COLOR);
  }
});
