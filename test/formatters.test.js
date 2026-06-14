'use strict';

// Formatter coverage. padRight() and formatFundingLine() are not exported, so they
// are exercised THROUGH the public output functions. Human/colored output only
// renders when stdout is a TTY (isJSON() returns true on a non-TTY, which under
// `node --test` is the default), so the human-branch tests stub process.stdout.isTTY.

const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../lib/formatters');

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
  assert.match(out, /2025-12-31/);
});

test('outputJobs formats funding valuation as $M and $B', () => {
  const big = capture(() => fmt.outputJobs([{ id: 1, title: 'X', company: { name: 'Y', fundingSeries: 'Series B', valuationMillions: 1500 } }]), { tty: true });
  assert.match(big, /\$1\.5B/);
  const small = capture(() => fmt.outputJobs([{ id: 2, title: 'Z', company: { name: 'W', fundingSeries: 'Seed', valuationMillions: 500 } }]), { tty: true });
  assert.match(small, /\$500M/);
});

test('outputJobs JSON mode emits parseable JSON with fields preserved (non-TTY)', () => {
  const out = capture(() => fmt.outputJobs([{ id: 9, title: 'PM' }]), { tty: false });
  const parsed = JSON.parse(out);
  assert.equal(parsed[0].id, 9);
  assert.equal(parsed[0].title, 'PM');
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
