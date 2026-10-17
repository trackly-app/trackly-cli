const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'classify-review-attempts.js');
const { classifyAttempt } = require(script);
const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'claude-code-review.yml'),
  'utf8',
);

// What a capped claude-code-action run writes: the API refused the first
// request, so one turn, no cost, and the CLI's own notice as the result.
function capped(text = "You've hit your usage limit · resets 3pm (America/Los_Angeles)") {
  return [
    { type: 'system', subtype: 'init' },
    { type: 'result', subtype: 'success', is_error: true, duration_ms: 343, num_turns: 1, total_cost_usd: 0, result: text },
  ];
}

function run(primary, fallback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attempt-class-'));
  const files = [primary, fallback].map((events, i) => {
    const file = path.join(dir, `attempt-${i}.json`);
    if (events !== undefined) fs.writeFileSync(file, typeof events === 'string' ? events : JSON.stringify(events));
    return file;
  });
  const result = spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(result.stdout.trim().split('\n').map((line) => line.split('=', 2)));
}

test('an API rejection for quota is a cap', () => {
  for (const text of [
    "You've hit your usage limit · resets 3pm (America/Los_Angeles)",
    'You have hit your weekly limit',
    'Claude AI usage limit reached|1760670000',
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}',
  ]) {
    assert.equal(classifyAttempt(capped(text)), 'quota', text);
  }
});

test('stream-json files, one event per line, are read', () => {
  assert.equal(classifyAttempt(capped().map((e) => JSON.stringify(e)).join('\n')), 'quota');
});

test('an auth rejection is never a cap', () => {
  assert.equal(classifyAttempt(capped('API Error: 401 OAuth token has expired, rate limit unaffected')), 'auth');
  assert.equal(classifyAttempt(capped('Invalid API key · Please run /login')), 'auth');
  assert.equal(classifyAttempt(capped('Not logged in · Please run /login')), 'auth');
});

test('cap wording from a run that spent money is not trusted', () => {
  const events = capped();
  Object.assign(events[1], { total_cost_usd: 0.42, num_turns: 3 });
  assert.equal(classifyAttempt(events), 'other');
});

test('a busy API, a model answer and a success are not caps', () => {
  assert.equal(classifyAttempt(capped('API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}')), 'other');
  assert.equal(classifyAttempt(capped('The diff adds a rate limit to the 429 handler.')), 'other');
  const ok = capped();
  Object.assign(ok[1], { is_error: false });
  assert.equal(classifyAttempt(ok), 'other');
});

test('a missing, empty or broken execution file is unknown', () => {
  assert.equal(classifyAttempt(null), 'missing');
  assert.equal(classifyAttempt(''), 'missing');
  assert.equal(classifyAttempt('{not json'), 'missing');
  assert.equal(classifyAttempt([{ type: 'system', subtype: 'init' }]), 'missing');
});

test('CLI reports both-capped only when both attempts were refused for quota', () => {
  assert.deepEqual(run(capped(), capped()), { class: 'both-capped', primary: 'quota', fallback: 'quota' });
  assert.deepEqual(run(capped(), capped('Invalid API key · Please run /login')), {
    class: 'other', primary: 'quota', fallback: 'auth',
  });
  assert.deepEqual(run(undefined, capped()), { class: 'other', primary: 'missing', fallback: 'quota' });
});

test('workflow wires the cap rule without turning other failures green', () => {
  assert.match(workflow, /classify-review-attempts\.js\?ref=\$\{BASE_SHA\}/);
  assert.match(workflow, /both_capped=true/);
  assert.match(workflow, /class=both-capped/);
});
