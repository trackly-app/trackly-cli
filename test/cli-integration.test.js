'use strict';

// End-to-end CLI tests: spawn bin/trackly against an in-process HTTP mock and
// assert the request line the CLI builds (flag → query-param / body mapping) and
// its exit behavior. This closes the gap that let the v0.2.1 flag-mapping
// regression ship — no test previously exercised a command handler end-to-end.
//
// The harness uses ASYNC execFile (via runCli), never spawnSync: a sync child
// blocks this process's event loop, so the in-process mock could never answer
// and the child would time out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempConfigDir, seedApiKey, startMockServer, runCli } = require('./helpers');
const packageVersion = require('../package.json').version;

test('published package version has a dated changelog section', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');

  assert.match(changelog, new RegExp(
    `^## \\[${packageVersion.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    'm',
  ));
});

// Spin up a temp config (seeded API key) + mock server, run the CLI, return the
// captured requests and the child result. `respond(req)` may return {status, json}.
async function runAgainstMock(t, args, respond, childEnv = {}) {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedApiKey(dir);

  const requests = [];
  const { server, port } = await startMockServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      const r = (respond && respond(req)) || { status: 200, json: {} };
      if (r.disconnect) return req.socket.destroy();
      if (r.body !== undefined) {
        res.writeHead(r.status || 200, r.headers || { 'Content-Type': 'application/octet-stream' });
        res.end(r.body);
      } else {
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json || {}));
      }
    });
  });
  t.after(() => server.close());

  const result = await runCli(args, {
    TRACKLY_CONFIG_DIR: dir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    ...childEnv,
  });
  return { requests, result };
}

// Parse the query string of the (single) captured request.
function query(requests) {
  const u = new URL(requests[0].url, 'http://x');
  return u.searchParams;
}

const HUMAN_ENV = { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}`, NO_COLOR: '1' };

test('auto-apply requests Trackly Apply (cloud) with acknowledgement and optional resume', async (t) => {
  for (const resumeId of [undefined, 21]) {
    const args = ['auto-apply', '42', ...(resumeId ? ['--resume-id', String(resumeId)] : [])];
    const response = { request: { id: 'request-1', jobId: 42, status: 'queued' } };
    for (const env of [HUMAN_ENV, {}]) {
      const { result, requests } = await runAgainstMock(t, args, () => ({ status: 201, json: response }), env);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/api/jobscout/apply/assist-requests');
      assert.deepEqual(JSON.parse(requests[0].body), { jobId: 42, acknowledged: true, ...(resumeId ? { resumeId } : {}) });
      if (env === HUMAN_ENV) {
        assert.match(result.stdout, /Trackly Apply \(cloud\) request request-1: queued/);
        assert.match(result.stdout, /Trackly will apply and notify you/);
      } else assert.deepEqual(JSON.parse(result.stdout), { ...response, message: 'Trackly will apply and notify you.' });
    }
  }
});

test('auto-apply --status lists requests without enqueueing', async (t) => {
  for (const requests of [[], [{ id: 'request-1', jobId: 42, status: 'submitted', applicantMessage: 'Applied successfully.' }]]) {
    for (const env of [HUMAN_ENV, {}]) {
      const run = await runAgainstMock(t, ['auto-apply', '--status'], () => ({ json: { requests } }), env);
      assert.equal(run.result.code, 0, run.result.stderr);
      assert.equal(run.requests.length, 1);
      assert.equal(run.requests[0].method, 'GET');
      assert.equal(run.requests[0].url, '/api/jobscout/apply/assist-requests');
      assert.equal(run.requests[0].body, '');
      if (env === HUMAN_ENV) assert.match(run.result.stdout, requests.length ? /Job 42: submitted.*\n.*Applied successfully/ : /No Trackly Apply \(cloud\) requests/);
      else assert.deepEqual(JSON.parse(run.result.stdout), { requests });
    }
  }
});

test('malformed auto-apply responses never report success or retry the mutation', async (t) => {
  for (const [args, body] of [
    [['auto-apply', '42'], {}], [['auto-apply', '42'], { request: null }],
    [['auto-apply', '42'], { request: { id: 'x', jobId: 41, status: 'queued' } }],
    [['auto-apply', '42'], { request: { id: 'x', jobId: 42 } }],
    [['auto-apply', '--status'], {}], [['auto-apply', '--status'], { requests: null }],
    [['auto-apply', '--status'], { requests: [{}] }],
    [['auto-apply', '42'], '<html>unexpected-response</html>'],
    [['auto-apply', '--status'], '<html>unexpected-response</html>'],
  ]) {
    for (const env of [HUMAN_ENV, {}]) {
      const { result, requests } = await runAgainstMock(t, args, () => (typeof body === 'string' ? { status: 201, body } : { status: 201, json: body }), env);
      assert.equal(result.code, 1);
      const message = env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message;
      assert.match(message, /Invalid Trackly Apply \(cloud\) response.*Check your request status/);
      assert.doesNotMatch(result.stdout + result.stderr, /TypeError|Trackly will apply/);
      assert.equal(requests.length, 1);
    }
  }
});

test('mark-applied reports what happened on the Tracker board with fixed text only', async (t) => {
  const cases = [
    [{ state: 'created' }, 'stdout', /Added to your Tracker board\./],
    [{ state: 'linked' }, 'stdout', /Linked to the matching card on your Tracker board\./],
    [{ state: 'moved' }, 'stdout', /Moved its Tracker card to applied\./],
    [{ state: 'existing', reason: 'ambiguous' }, 'stderr', /More than one Tracker card matches this job/],
    [{ state: 'skipped', reason: 'tracker_unavailable' }, 'stderr', /The Tracker board was not updated \(it is switched off\)\./],
    [{ state: 'skipped', reason: 'surface_disabled' }, 'stderr', /The Tracker board was not updated \(it is switched off\)\./],
    // Other skips (for example nothing to build an entry from) never claim the Tracker is off.
    [{ state: 'skipped', reason: 'no_evidence' }, 'stderr', /^The Tracker board was not updated\.$/m],
    [{ state: 'moved', reason: 'stage_not_current' }, 'stderr', /A later event on its Tracker card still decides the card's stage/],
    // close-ai returns stage_not_current with existing too, when a later-dated event keeps the card earlier.
    [{ state: 'existing', reason: 'stage_not_current' }, 'stderr', /A later event on its Tracker card still decides the card's stage/],
    [{ state: 'created', reason: 'stage_not_current' }, 'stderr', /A later event on its Tracker card still decides the card's stage/],
    [{ state: 'failed', reason: 'lock_timeout', retryable: true }, 'stderr', /Run the same command again; it is safe to repeat\./],
  ];
  for (const [trackerEntry, stream, expected] of cases) {
    const body = { success: true, status: 'applied_confirmed', trackerEntry };
    const { result } = await runAgainstMock(t, ['mark-applied', '42'], () => ({ json: body }), HUMAN_ENV);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Job 42 marked as/);
    assert.match(result[stream], expected, trackerEntry.state);
    // JSON callers get the backend object unchanged.
    const json = await runAgainstMock(t, ['mark-applied', '42'], () => ({ json: body }));
    assert.deepEqual(JSON.parse(json.result.stdout), body);
  }
  // An existing card at applied or later, an unknown future state, or an older backend without trackerEntry adds no line.
  for (const body of [{ success: true, trackerEntry: { state: 'existing' } }, { success: true, trackerEntry: { state: 'some_future_state' } }, { success: true }]) {
    const { result } = await runAgainstMock(t, ['mark-applied', '42'], () => ({ json: body }), HUMAN_ENV);
    assert.equal(result.stdout.trim(), 'Job 42 marked as applied.');
    assert.equal(result.stderr, '');
  }
});

test('apply <id> still marks a job applied exactly as in 0.25.0, with a mark-applied hint', async (t) => {
  for (const env of [HUMAN_ENV, {}]) {
    const { result, requests } = await runAgainstMock(t, ['apply', '42'], () => ({ json: { success: true } }), env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/jobscout/tracker/jobs/42/stage');
    assert.deepEqual(JSON.parse(requests[0].body), { stage: 'applied' });
    if (env === HUMAN_ENV) {
      assert.match(result.stdout, /Job 42 marked as/);
      assert.match(result.stderr, /trackly mark-applied <id>/);
    } else {
      assert.deepEqual(JSON.parse(result.stdout), { success: true });
      assert.equal(result.stderr, '');
    }
  }
  for (const args of [['apply', '42', '--status'], ['apply', '--status'], ['apply', '42', '--resume-id', '7'], ['apply', 'abc']]) {
    const { result, requests } = await runAgainstMock(t, args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.equal(requests.length, 0, `${args.join(' ')} must not reach the API`);
    assert.match(result.stderr, /Unknown option --(status|resume-id) for 'trackly apply'|Usage: trackly apply <id>/);
  }
});

test('apply with no job ID explains Trackly Apply (local), Trackly Apply (cloud) and mark applied without any request', async (t) => {
  for (const env of [HUMAN_ENV, {}]) {
    const { result, requests } = await runAgainstMock(t, ['apply'], undefined, env);
    assert.equal(requests.length, 0);
    // A terminal gets the guide; scripts and JSON callers still fail on a missing ID, as in 0.25.0.
    assert.equal(result.code, env === HUMAN_ENV ? 0 : 1, result.stderr);
    if (env !== HUMAN_ENV) {
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.success, false);
      assert.equal(payload.error, 'job_id_required');
      assert.match(payload.message, /Usage: trackly apply <id>/);
    }
    const text = env === HUMAN_ENV ? result.stdout : Object.values(JSON.parse(result.stdout).ways).join('\n');
    assert.match(text, /Trackly Apply \(local\).*your browser on your computer.*stops before Submit.*trackly agent setup/);
    assert.match(text, /Trackly Apply \(cloud\): .*trackly auto-apply <jobId>.*Trackly applies for you.*nothing runs on your computer/);
    assert.match(text, /Mark applied: .*trackly mark-applied <jobId>/);
    assert.doesNotMatch(text, /cloud auto-apply/i, 'old wording is gone');
    if (env !== HUMAN_ENV) {
      // The 0.26.0 JSON keys stay, so existing scripts keep reading them.
      assert.deepEqual(Object.keys(JSON.parse(result.stdout).ways), ['tracklyApply', 'cloudAutoApply', 'markApplied']);
    }
  }
});

test('help lists all three ways to apply, and auto-apply --help describes Trackly Apply (cloud)', async () => {
  const help = await runCli(['--help']);
  assert.match(help.stdout, /apply\s+How to apply with Trackly: Trackly Apply \(local\), Trackly Apply \(cloud\), mark applied/);
  assert.match(help.stdout, /mark-applied <id>\s+Record a job you applied to yourself/);
  assert.match(help.stdout, /apply <id>\s+Same as mark-applied/);
  assert.match(help.stdout, /auto-apply <id>\s+Request Trackly Apply \(cloud\): Trackly applies for you/);
  assert.match(help.stdout, /auto-apply --status\s+List your Trackly Apply \(cloud\) requests/);
  assert.doesNotMatch(help.stdout, /cloud auto-apply/i);
  for (const flag of ['--help', '-h']) {
    const commandHelp = await runCli(['auto-apply', flag]);
    assert.equal(commandHelp.code, 0, commandHelp.stderr);
    assert.match(commandHelp.stdout, /^trackly auto-apply: Trackly Apply \(cloud\)/);
    assert.match(commandHelp.stdout, /Trackly applies to the employer for you/);
    assert.match(commandHelp.stdout, /Nothing runs on your computer/);
    assert.match(commandHelp.stdout, /trackly auto-apply <jobId> \[--resume-id <id>\]/);
    assert.match(commandHelp.stdout, /trackly auto-apply --status/);
    assert.match(commandHelp.stdout, /Trackly Apply \(local\): .*stops\s+before Submit; you submit\. Set it up with `trackly agent setup`/);
    assert.match(commandHelp.stdout, /Mark applied: .*trackly mark-applied <jobId>/);
  }
});

test('invalid manual tracking commands recommend mark-applied without submitting', async (t) => {
  for (const id of [undefined, 'abc', '0']) {
    const { result, requests } = await runAgainstMock(t, ['mark-applied', ...(id ? [id] : [])]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Usage: trackly mark-applied <id>/);
    assert.doesNotMatch(result.stderr, /Usage: trackly apply/);
    assert.equal(requests.length, 0);
  }
});

test('auto-apply validates IDs and status combinations before HTTP', async (t) => {
  for (const args of [[], ['0'], ['-1'], ['1.5'], ['2147483648'], ['abc'], ['42', '43'],
    ['42', '--resume-id'], ['42', '--resume-id', '0'], ['42', '--resume-id', '2147483648'],
    ['42', '--status'], ['--status=true'], ['--status', '--resume-id', '21']]) {
    const { result, requests } = await runAgainstMock(t, ['auto-apply', ...args]);
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(requests.length, 0);
  }
});

test('whoami shows only a returned plan and uses the me endpoint', async (t) => {
  for (const tier of ['scout', 'apply', 'ultra', undefined]) {
    const user = { id: 7, name: 'Test User', email: 'test@example.com', ...(tier ? { plan: {
      tier, source: tier === 'scout' ? 'free' : 'paid', studentEligible: true, enforced: true, subscription: null,
    } } : {}) };
    for (const env of [HUMAN_ENV, {}]) {
      const { result, requests } = await runAgainstMock(t, ['whoami'], () => ({ json: { success: true, user } }), env);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(requests[0].url, '/api/jobscout/me');
      if (env !== HUMAN_ENV) assert.deepEqual(JSON.parse(result.stdout), user);
      else if (tier) assert.match(result.stdout, new RegExp(`Plan: ${tier}`));
      else assert.doesNotMatch(result.stdout, /Plan:/);
    }
  }
});

test('CLI refusals show server plan fields or a temporary rate limit on every command', async (t) => {
  for (const args of [['ask', 'PM jobs'], ['jobs'], ['auto-apply', '42']]) {
    for (const error of ['limit_reached', 'assist_limit_reached', 'slow_down']) {
      const body = error === 'slow_down' ? { error } : { success: false, error, feature: 'agent_fill',
        used: 100, limit: 100, resetsAt: '2026-12-01T00:00:00Z', upgradeUrl: 'https://example.com/opaque-upgrade' };
      for (const env of [HUMAN_ENV, {}]) {
        const { result, requests } = await runAgainstMock(t, args, () => ({ status: 429, json: body }), env);
        assert.equal(result.code, 1);
        assert.equal(requests.length, 1, 'refusals must not retry');
        const text = env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message;
        if (env !== HUMAN_ENV) assert.equal(JSON.parse(result.stdout).retryable, error === 'slow_down' ? undefined : false);
        assert.doesNotMatch(text, /20 natural|daily/i);
        if (error === 'slow_down') assert.match(text, /Rate limited, try again shortly/);
        else {
          assert.match(text, /agent fills.*Used 100 of 100.*Resets on/);
          assert.match(text, /https:\/\/example.com\/opaque-upgrade/);
          if (env !== HUMAN_ENV) {
            const payload = JSON.parse(result.stdout);
            for (const key of ['error', 'feature', 'used', 'limit', 'resetsAt', 'upgradeUrl']) assert.deepEqual(payload[key], body[key]);
          }
        }
      }
    }
  }
});

test('CLI structured refusals omit malformed server plan fields', async (t) => {
  const { result } = await runAgainstMock(t, ['auto-apply', '42'], () => ({ status: 429, json: {
    error: 'limit_reached', feature: 'constructor', used: 'untrusted-text', limit: -1,
    resetsAt: {}, upgradeUrl: 'javascript:alert(1)',
  } }));
  const payload = JSON.parse(result.stdout);
  assert.equal(result.code, 1);
  assert.equal(payload.retryable, false);
  for (const key of ['feature', 'used', 'limit', 'resetsAt', 'upgradeUrl']) assert.equal(Object.hasOwn(payload, key), false);
  assert.doesNotMatch(result.stdout, /untrusted-text|javascript|constructor/);
});

test('uncertain auto-apply enqueues require status checks without retrying', async (t) => {
  for (const response of [{ status: 500, json: { error: 'unavailable' } }, { disconnect: true }]) {
    for (const env of [HUMAN_ENV, {}]) {
      const { result, requests } = await runAgainstMock(t, ['auto-apply', '42'], () => response, env);
      assert.equal(result.code, 1);
      assert.equal(requests.length, 1);
      const message = env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message;
      assert.match(message, /Check your request status with trackly auto-apply --status before requesting again/);
      assert.doesNotMatch(result.stdout + result.stderr, /Trackly will apply/);
      if (env !== HUMAN_ENV) {
        assert.equal(result.stderr, '');
        assert.equal(JSON.parse(result.stdout).retryable, false);
        assert.equal(JSON.parse(result.stdout).code, 'auto_apply_status_unknown');
      }
    }
  }
});

test('auto-apply preserves recognized maintenance and controlled-access envelopes', async (t) => {
  for (const code of ['maintenance_mode', 'ACCESS_CHECK_UNAVAILABLE']) {
    const { result, requests } = await runAgainstMock(t, ['auto-apply', '42'],
      () => ({ status: 503, json: { code, message: 'Temporarily unavailable' } }));
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).code, code);
    assert.equal(requests.length, 1);
  }
});

test('request-company uses generic throttling for 429 without plan fields', async (t) => {
  for (const env of [HUMAN_ENV, {}]) {
    const { result, requests } = await runAgainstMock(t, ['request-company', 'Example'],
      () => ({ status: 429, json: { error: 'Maximum 5 pending requests allowed.' } }), env);
    assert.equal(result.code, 1);
    assert.equal(requests.length, 1);
    assert.match(env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message, /Rate limited, try again shortly/);
    if (env !== HUMAN_ENV) assert.equal(JSON.parse(result.stdout).error, 'Maximum 5 pending requests allowed.');
  }
});

test('whoami tolerates every subscription status and never sends plan inputs', async (t) => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'canceled']) {
    const user = { id: 7, name: 'Test User', email: 'test@example.com', plan: {
      tier: 'apply', source: 'paid', studentEligible: false, enforced: true,
      subscription: { status, renewsAt: null, cancelAtPeriodEnd: false }, futureField: 'ignored',
    } };
    const { result, requests } = await runAgainstMock(t, ['whoami'], () => ({ json: { success: true, user } }));
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), user);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].body, '');
  }
});

test('auto-apply preserves the backend missing-job refusal', async (t) => {
  for (const env of [HUMAN_ENV, {}]) {
    const { result, requests } = await runAgainstMock(t, ['auto-apply', '42'],
      () => ({ status: 404, json: { error: 'job_not_found' } }), env);
    assert.equal(result.code, 1);
    assert.equal(requests.length, 1);
    assert.match(env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message, /Job not found.*Check the Trackly job ID/);
    assert.doesNotMatch(result.stdout + result.stderr, /not available for this account/);
    if (env !== HUMAN_ENV) {
      assert.equal(JSON.parse(result.stdout).error, 'job_not_found');
      assert.equal(JSON.parse(result.stdout).retryable, false);
    }
  }
});

test('auto-apply 404 reports account availability for enqueue and status', async (t) => {
  for (const args of [['auto-apply', '42'], ['auto-apply', '--status']]) {
    for (const env of [HUMAN_ENV, {}]) {
      const { result, requests } = await runAgainstMock(t, args, () => ({ status: 404, json: { error: 'feature_disabled' } }), env);
      assert.equal(result.code, 1);
      assert.match(env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message, /Trackly Apply \(cloud\) is not available for this account yet/);
      assert.equal(requests.length, 1);
    }
  }
});

test('auto-apply preserves JSON and non-JSON 404 diagnostics without raw bodies', async (t) => {
  for (const response of [
    { status: 404, json: { error: 'Not found' } },
    { status: 404, body: '<html>private-proxy-body</html>', headers: { 'Content-Type': 'text/html' } },
  ]) {
    for (const env of [HUMAN_ENV, {}]) {
      const { result } = await runAgainstMock(t, ['auto-apply', '42'], () => response, env);
      assert.equal(result.code, 1);
      const text = env === HUMAN_ENV ? result.stderr : JSON.parse(result.stdout).message;
      assert.match(text, /Trackly Apply \(cloud\) is not available for this account yet.*API diagnostic:/);
      assert.match(text, response.json ? /Not found/ : /non-JSON response/);
      assert.doesNotMatch(result.stdout + result.stderr, /private-proxy-body/);
    }
  }
});

test('auto-apply diagnostics strip terminal controls and cap server text', async (t) => {
  for (const args of [['auto-apply', '42'], ['auto-apply', '--status']]) {
    for (const env of [HUMAN_ENV, {}]) {
      const { result } = await runAgainstMock(t, args,
        () => ({ status: 404, json: { error: 'Not found\u001b[31m\u0007\r\n\u007f\u009b' } }), env);
      assert.equal(result.code, 1);
      const payload = env === HUMAN_ENV ? null : JSON.parse(result.stdout);
      const text = payload ? payload.message : result.stderr.trim();
      assert.match(text, /API diagnostic: Not found\[31m$/);
      assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/);
      if (payload) assert.equal(payload.diagnostic, 'Not found[31m');
    }
  }
  for (const env of [HUMAN_ENV, {}]) {
    const { result, requests } = await runAgainstMock(t, ['auto-apply', '42'],
      () => ({ status: 500, json: { error: '\u001b\u0007\r\n\u007f\u009b' + 'x'.repeat(900) } }), env);
    assert.equal(result.code, 1);
    assert.equal(requests.length, 1);
    const payload = env === HUMAN_ENV ? null : JSON.parse(result.stdout);
    const text = payload ? payload.message : result.stderr.trim();
    assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]|x{501}/);
    assert.match(text, /x{500}\. Check your request status with trackly auto-apply --status/);
    if (payload) assert.equal(payload.retryable, false);
  }
});

test('jobs maps every filter flag to the right query param', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['jobs', '--function', 'product', '--region', 'us', '--job-type', 'internship', '--work-arrangement', 'hybrid,remote', '--company', '243', '--keywords', 'fintech'],
    () => ({ status: 200, json: { jobs: [] } })
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  const q = query(requests);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/jobs');
  assert.equal(q.get('jobFunction'), 'product');
  assert.equal(q.get('locationFilter'), 'us');
  assert.equal(q.get('jobModality'), 'internship');
  assert.equal(q.get('workArrangements'), 'hybrid,remote');
  assert.equal(q.get('companyId'), '243');
  assert.equal(q.get('search'), 'fintech');
});

test('jobs maps --role-types to the roleTypes query parameter', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--role-types', 'corporate,frontline,corporate'], () => ({ status: 200, json: { jobs: [] } }));
  assert.equal(result.code, 0, result.stderr);
  const url = new URL(requests[0].url, 'http://localhost');
  assert.equal(url.searchParams.get('roleTypes'), 'corporate,frontline');
});

test('jobs rejects invalid role-types values before making a request', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--role-types', 'retail']);
  assert.notEqual(result.code, 0);
  assert.equal(requests.length, 0);
  assert.match(result.stderr, /Invalid --role-types value "retail"/);
});

test('jobs rejects invalid work-arrangement values before making a request', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--work-arrangement', 'onsite']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /remote, hybrid, in_person, unspecified/);
  assert.equal(requests.length, 0, 'must fail before any API call');
});

test('jobs ID alias with work-arrangement stays on the filtered list route', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['jobs', '123', '--work-arrangement', 'remote'],
    () => ({ status: 200, json: { jobs: [] } })
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/jobs');
  assert.equal(query(requests).get('workArrangements'), 'remote');
});

test('jobs --remote maps to usStates=REMOTE', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--remote'], () => ({ status: 200, json: { jobs: [] } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(query(requests).get('usStates'), 'REMOTE');
});

test('jobs --remote --region conflict exits non-zero and makes no request', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--remote', '--region', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /cannot be combined/);
  assert.equal(requests.length, 0, 'must fail before any API call');
});

test('deprecated --location is rejected with a migration hint (regression guard)', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--location', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--location was removed/);
  assert.equal(requests.length, 0);
});

// Job detail must distinguish "the backend answered null/unknown" (a real
// "Not mentioned" verdict) from "this backend predates the field" (key absent).
const jobDetail = (extra) => ({ status: 200, json: { job: { id: 7, title: 'PM', companyName: 'Acme', ...extra } } });

test('job detail renders a returned null sponsorship status as Not mentioned', async (t) => {
  const { result } = await runAgainstMock(t, ['job', '7'], () => jobDetail({ sponsorshipStatus: null }), { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}` });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Sponsorship: Not mentioned/);
});

test('job detail renders an unknown sponsorship status as Not mentioned', async (t) => {
  const { result } = await runAgainstMock(t, ['job', '7'], () => jobDetail({ sponsorshipStatus: 'unknown' }), { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}` });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Sponsorship: Not mentioned/);
  assert.doesNotMatch(result.stdout, /unknown/i);
});

test('job detail renders the classified sponsorship labels', async (t) => {
  for (const [status, label] of [['yes', 'Sponsors visa'], ['no', 'No sponsorship']]) {
    const { result } = await runAgainstMock(t, ['job', '7'], () => jobDetail({ sponsorshipStatus: status }), { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}` });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Sponsorship: ${label}`));
  }
});

test('job detail omits the sponsorship line when the backend never returns the field', async (t) => {
  const { result } = await runAgainstMock(t, ['job', '7'], () => jobDetail({}), { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}` });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Sponsorship:/);
});

test('job --json passes a null sponsorship status through untouched', async (t) => {
  const { result } = await runAgainstMock(t, ['job', '7', '--json'], () => jobDetail({ sponsorshipStatus: null }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).job.sponsorshipStatus, null);
});

test('mark-applied/save/dismiss POST the correct tracker stage', async (t) => {
  for (const [action, stage] of [['mark-applied', 'applied'], ['save', 'backlog'], ['dismiss', 'discarded']]) {
    const { requests, result } = await runAgainstMock(t, [action, '1234'], () => ({ status: 200, json: { ok: true } }));
    assert.equal(result.code, 0, `${action}: ${result.stderr}`);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/jobscout/tracker/jobs/1234/stage');
    assert.equal(JSON.parse(requests[0].body).stage, stage, `${action} → stage=${stage}`);
  }
});

test('companies search hits the semantic search endpoint with q', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['companies', 'search', 'fintech'], () => ({ status: 200, json: { companies: [] } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/companies/search');
  assert.equal(new URL(requests[0].url, 'http://x').searchParams.get('q'), 'fintech');
});

test('request-company POSTs source:"cli" and the company name', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['request-company', 'Built Robotics', '--url', 'https://builtrobotics.com', '--notes', 'mba'],
    () => ({ status: 200, json: { requestId: 1 } })
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/api/jobscout/companies/request');
  const sent = JSON.parse(requests[0].body);
  assert.equal(sent.source, 'cli');
  assert.equal(sent.company_name, 'Built Robotics');
  assert.equal(sent.company_url, 'https://builtrobotics.com');
});

test('preferences --json reads the authenticated discovery preferences', async (t) => {
  const response = {
    success: true,
    user: {
      email: 'must-not-leak@example.com',
      experienceFilterV2Available: true,
      preferences: {
        wantedJobFunctions: ['product', 'strategy'],
        experienceLimitsByJobFunction: { product: 2, strategy: 5 },
        experienceFilterVersion: 2,
        experienceFilterV2Active: true,
        discoveryPreferenceRevision: 7,
      },
    },
  };
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', '--json'],
    () => ({ status: 200, json: response }),
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: '/api/jobscout/me' },
  ]);
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    experienceFilterV2Available: true,
    preferences: response.user.preferences,
  });
});

test('preferences human output explains inclusive role limits and unstated requirements', async (t) => {
  const { result } = await runAgainstMock(
    t,
    ['preferences'],
    () => ({
      status: 200,
      json: {
        success: true,
        user: {
          experienceFilterV2Available: true,
          preferences: {
            wantedJobFunctions: ['product'],
            experienceLimitsByJobFunction: { product: 2 },
            experienceFilterV2Active: true,
            discoveryPreferenceRevision: 7,
          },
        },
      },
    }),
    { NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}` },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Experience limits: Configured/);
  assert.match(result.stdout, /product: Up to 2 years required/);
  assert.match(result.stdout, /Jobs with no stated minimum remain visible\./);
  assert.doesNotMatch(result.stdout, /filter:\s*(?:On|Off)/i);
});

test('preferences experience atomically replaces role limits using the latest revision', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', 'experience', 'product=2', 'strategy=5', '--json'],
    (req) => {
      if (req.method === 'GET') {
        return {
          status: 200,
          json: {
            success: true,
            user: {
              experienceFilterV2Available: true,
              preferences: { discoveryPreferenceRevision: 11 },
            },
          },
        };
      }
      return {
        status: 200,
        json: {
          success: true,
          preferences: {
            experienceLimitsByJobFunction: { product: 2, strategy: 5 },
            experienceFilterVersion: 2,
            experienceFilterV2Active: true,
            discoveryPreferenceRevision: 12,
          },
          discoveryPreferenceRevision: 12,
        },
      };
    },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: 'GET', url: '/api/jobscout/me' },
      { method: 'PUT', url: '/api/jobscout/preferences' },
    ],
  );
  assert.deepEqual(JSON.parse(requests[1].body), {
    experienceLimitsByJobFunction: { product: 2, strategy: 5 },
    experienceFilterVersion: 2,
    expectedPreferenceRevision: 11,
  });
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    experienceFilterV2Available: true,
    preferences: {
      experienceLimitsByJobFunction: { product: 2, strategy: 5 },
      experienceFilterVersion: 2,
      experienceFilterV2Active: true,
      discoveryPreferenceRevision: 12,
    },
  });
});

test('preferences experience clear sends an empty V2 map and retains revision safety', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', 'experience', 'clear', '--json'],
    (req) => req.method === 'GET'
      ? {
          status: 200,
          json: {
            success: true,
            user: {
              experienceFilterV2Available: true,
              preferences: { discoveryPreferenceRevision: 4 },
            },
          },
        }
      : {
          status: 200,
          json: {
            success: true,
            preferences: {
              experienceLimitsByJobFunction: {},
              experienceFilterVersion: 2,
              experienceFilterV2Active: false,
              discoveryPreferenceRevision: 5,
            },
            discoveryPreferenceRevision: 5,
          },
        },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].body), {
    experienceLimitsByJobFunction: {},
    experienceFilterVersion: 2,
    expectedPreferenceRevision: 4,
  });
});

test('preferences experience rejects invalid limits before making a request', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', 'experience', 'product=61'],
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /integer from 0 to 60/i);
  assert.equal(requests.length, 0);
});

test('preferences experience refuses the write when V2 capability is unavailable', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', 'experience', 'product=2'],
    () => ({
      status: 200,
      json: {
        success: true,
        user: {
          experienceFilterV2Available: false,
          preferences: { discoveryPreferenceRevision: 8 },
        },
      },
    }),
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /not available/i);
  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: '/api/jobscout/me' },
  ], 'capability denial must not send a PUT');
});

test('preferences experience never retries a revision conflict', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['preferences', 'experience', 'product=2', '--json'],
    (req) => req.method === 'GET'
      ? {
          status: 200,
          json: {
            success: true,
            user: {
              experienceFilterV2Available: true,
              preferences: { discoveryPreferenceRevision: 8 },
            },
          },
        }
      : {
          status: 409,
          json: {
            success: false,
            error: 'preference_revision_conflict',
            preferences: { discoveryPreferenceRevision: 9 },
            discoveryPreferenceRevision: 9,
          },
        },
  );

  assert.notEqual(result.code, 0);
  assert.equal(requests.length, 2, 'the mutation must not retry with a newer revision');
  const output = JSON.parse(result.stdout);
  assert.equal(output.code, 'preference_revision_conflict');
  assert.equal(output.discoveryPreferenceRevision, 9);
});

test('ask sends the natural-language query to the /ask endpoint (url-encoded)', async (t) => {
  // Note: the CLI's jobsUrl allowlist-follow runs only in human/TTY mode; under a
  // piped child stdout (non-TTY) `ask` returns the raw JSON result, so this test
  // covers the in-scope query mapping. (The MCP server applies the allowlist
  // unconditionally; that path is unchanged by this PR.)
  const { requests, result } = await runAgainstMock(t, ['ask', 'pm jobs at fintech'], () => ({
    status: 200,
    json: { parsedFilters: { jobFunction: 'product' }, jobsUrl: '/api/jobscout/jobs?x=1' },
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/ask');
  assert.equal(new URL(requests[0].url, 'http://x').searchParams.get('q'), 'pm jobs at fintech');
});

test('--json mode emits parseable JSON on stdout', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--json'], () => ({ status: 200, json: { jobs: [{ id: 1, title: 'PM' }] } }));
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed[0].id, 1);
});

test('--json preserves canonical maintenance status, retry, ETA, and request ID', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--json'], () => ({
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '480',
      'X-Request-Id': 'req-cli-json',
      'X-Trackly-Maintenance': 'maintenance_mode',
    },
    body: JSON.stringify({
      success: false,
      status: 'maintenance',
      code: 'maintenance_mode',
      message: 'Trackly is migrating.',
      estimatedReturn: '10:00 AM PT',
      retryAfterSeconds: 480,
    }),
  }));

  assert.notEqual(result.code, 0);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 503);
  assert.equal(parsed.serviceStatus, 'maintenance');
  assert.equal(parsed.code, 'maintenance_mode');
  assert.equal(parsed.retryAfterSeconds, 480);
  assert.equal(parsed.estimatedReturn, '10:00 AM PT');
  assert.equal(parsed.requestId, 'req-cli-json');
  assert.equal(parsed.retryable, false);
  assert.match(parsed.guidance, /resume the existing agent_browser run/);
});

test('--json emits structured rollout denials on stdout', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--json'], () => ({
    status: 403,
    json: { code: 'INVITATION_REDEEMED', error: 'backend wording' },
  }));

  assert.notEqual(result.code, 0);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 403);
  assert.equal(parsed.code, 'INVITATION_REDEEMED');
  assert.equal(parsed.retryable, false);
  assert.match(parsed.message, /limited rollout/i);
  assert.match(parsed.message, /https:\/\/usetrackly\.app\/early-access/);
});

test('Apply maintenance emits resume guidance and never retries the mutation', async (t) => {
  // Runs for the mark-applied path and for the Trackly Apply (cloud) path.
  for (const [command, url] of [
    ['apply', '/api/jobscout/tracker/jobs/1234/stage'],
    ['auto-apply', '/api/jobscout/apply/assist-requests'],
  ]) {
  let responseCount = 0;
  const { requests, result } = await runAgainstMock(t, [command, '1234', '--json'], () => {
    responseCount++;
    return {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'maintenance',
        code: 'maintenance_mode',
        message: 'Tracker writes are paused.',
        retryAfterSeconds: 120,
      }),
    };
  });

  assert.notEqual(result.code, 0);
  assert.equal(requests.length, 1, 'maintenance must not repeat the Apply mutation');
  assert.equal(responseCount, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, url);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.code, 'maintenance_mode');
  assert.equal(parsed.retryable, false);
  assert.match(parsed.guidance, /Never create a duplicate run or click Submit/);
  }
});

test('unknown flag is rejected with a did-you-mean suggestion', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--regoin', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown option --regoin/);
  assert.match(result.stderr, /Did you mean --region/);
  assert.equal(requests.length, 0);
});

test('a valid flag on the wrong command is rejected', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--url', 'x']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown option --url/);
});

test('config rejects --api-key together with --clear-api-key', async (t) => {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await runCli(['config', '--api-key', 'trk_abcdefghij', '--clear-api-key'], { TRACKLY_CONFIG_DIR: dir });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Cannot use --api-key and --clear-api-key together/);
});

test('config --clear-api-key removes the final credential without writing an opt-out', async (t) => {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ apiKey: 'trk_last_credential', mcpAnalyticsOptOut: true }),
    { mode: 0o600 },
  );

  const requests = [];
  const { server, port } = await startMockServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ shareUsageAnalytics: true, optOutAvailable: false }));
  });
  t.after(() => server.close());

  const result = await runCli(['config', '--clear-api-key'], {
    TRACKLY_CONFIG_DIR: dir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests, [], 'credential removal must not consult the analytics preference');
  // `config` persists its remaining settings after clearing the key; nothing
  // about analytics may survive in that rewrite.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), {});
  assert.match(result.stdout, /Stored API key cleared/);
});

test('logout clears credentials without leaving config, even when the server is unreachable', async (t) => {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ token: 'jwt_last', refreshToken: 'rt_last', baseUrl: 'https://custom.example' }),
    { mode: 0o600 },
  );

  const { server, port } = await startMockServer(() => {});
  await new Promise((resolve) => server.close(resolve));

  const result = await runCli(['logout'], {
    TRACKLY_CONFIG_DIR: dir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Logged out\. Credentials cleared/);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
});

test('agent setup rejects --client without a value', async () => {
  const result = await runCli(['agent', 'setup', '--client']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing value for --client/);
});

test('agent setup returns structured errors in JSON mode', async () => {
  const result = await runCli(['agent', 'setup', '--client', 'unsupported', '--json']);
  assert.notEqual(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { error: 'Use --client codex, claude, or both.' });
  assert.equal(result.stderr, '');
});

test('agent setup exits non-zero when the requested client is not installed', async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const emptyBin = path.join(root, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const result = await runCli(['agent', 'setup', '--client', 'codex', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    CODEX_HOME: path.join(root, '.codex'),
    PATH: emptyBin,
  });
  assert.notEqual(result.code, 0);
  assert.equal(JSON.parse(result.stdout).clients[0].mcp.status, 'missing_client');
});

test('agent doctor JSON exits non-zero when setup is not ready', async (t) => {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await runCli(['agent', 'doctor', '--json'], { TRACKLY_CONFIG_DIR: dir });
  assert.notEqual(result.code, 0);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test('agent evidence returns the authenticated value-free beta report', async (t) => {
  const report = {
    windowDays: 90,
    targetReviewedRuns: 20,
    summary: { totalRuns: 4, reviewedRuns: 3, submittedRuns: 2, blockedRuns: 1, failedRuns: 0, activeRuns: 1, excludedLegacyRuns: 2 },
    providers: [{ provider: 'greenhouse', totalRuns: 4, reviewedRuns: 3, submittedRuns: 2, blockedRuns: 1 }],
    evidence: {
      criticalContact: { verifiedRuns: 3, correctedRuns: 1, unresolvedFailureRuns: 0, coveragePercent: 100 },
      manualSubmitBoundary: { verifiedRuns: 3, violationRuns: 0, coveragePercent: 100 },
    },
    releaseGate: { ready: false, blockers: ['reviewed_target_not_met'] },
  };
  const { requests, result } = await runAgainstMock(
    t,
    ['agent', 'evidence', '--window-days', '90', '--target-reviewed-runs', '20', '--json'],
    () => ({ status: 200, json: { success: true, report } }),
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/apply/evidence');
  const params = query(requests);
  assert.equal(params.get('windowDays'), '90');
  assert.equal(params.get('targetReviewedRuns'), '20');
  assert.deepEqual(JSON.parse(result.stdout).report, report);
});

test('agent doctor never mints a placeholder run to prepare a resume', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['agent', 'doctor', '--json'], (req) => {
    if (req.url === '/api/jobscout/apply/protocol') {
      return { json: { protocol: { compatibleSkillMajor: 4, version: '3.1.0' } } };
    }
    if (req.url === '/api/jobscout/application-profile') {
      return { json: { profile: { revision: 1, completeness: { percent: 100, missingKeys: [] }, defaultResume: { id: 7, fileName: 'Resume.pdf' } } } };
    }
    return { status: 404, json: { error: 'not found' } };
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.resume.available, true);
  assert.match(report.resume.validation, /real Apply run/i);
  assert.equal(requests.some((request) => request.url.includes('/default-resume')), false);
  assert.equal(result.code, report.ok ? 0 : 1);
});

test('agent doctor explains that exact resume validation is deferred to a real Apply run', async (t) => {
  const { result } = await runAgainstMock(t, ['agent', 'doctor'], (req) => {
    if (req.url === '/api/jobscout/apply/protocol') {
      return { json: { protocol: { compatibleSkillMajor: 4, version: '3.1.0' } } };
    }
    if (req.url === '/api/jobscout/application-profile') {
      return { json: { profile: { revision: 1, completeness: { percent: 100, missingKeys: [] }, defaultResume: { id: 7, fileName: 'Resume.pdf' } } } };
    }
    return { status: 404, json: { error: 'not found' } };
  }, {
    NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}`,
    NO_COLOR: '1',
  });

  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes(
    `CLI: ${packageVersion}; MCP contract: 3.9.4`,
  ));
  assert.match(result.stdout, /Skill: 4\.9\.6; digest: [a-f0-9]{64}/);
  assert.match(result.stdout, /Resume validation: available \(exact bytes are verified during an active Apply run\)/);
});

test('agent doctor renders API maintenance through the real human output path', async (t) => {
  const { result } = await runAgainstMock(t, ['agent', 'doctor'], (req) => {
    if (req.url === '/api/jobscout/apply/protocol') {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-doctor-api' },
        body: JSON.stringify({
          status: 'maintenance',
          code: 'maintenance_mode',
          message: 'The Apply API is paused.',
          estimatedReturn: '10:45 AM PT',
        }),
      };
    }
    if (req.url === '/api/jobscout/application-profile') {
      return { json: { profile: { revision: 1, completeness: { percent: 100, missingKeys: [] }, defaultResume: null } } };
    }
    return { status: 404, json: { error: 'not found' } };
  }, {
    NODE_OPTIONS: `--require=${path.join(__dirname, 'force-tty.js')}`,
    NO_COLOR: '1',
  });

  assert.notEqual(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /API: Trackly is upgrading The Apply API is paused/);
  assert.match(result.stdout, /Code: maintenance_mode; HTTP status: 503; service status: maintenance/);
  assert.match(result.stdout, /Request ID: req-doctor-api/);
  assert.match(result.stdout, /resume the existing agent_browser run/);
});

test('agent setup does not treat similarly named Codex MCP tables as registered', async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const codexHome = path.join(root, '.codex');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '[mcp_servers.trackly-old]\n# [mcp_servers.trackly]\n');
  const codex = path.join(bin, 'codex');
  fs.writeFileSync(codex, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const result = await runCli(['agent', 'setup', '--client', 'codex', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    CODEX_HOME: codexHome,
    PATH: `${bin}:${process.env.PATH}`,
  });
  assert.notEqual(result.code, 0);
  assert.equal(JSON.parse(result.stdout).clients[0].mcp.status, 'failed');
});

test('agent setup replaces a stale exact Codex MCP registration', async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const codexHome = path.join(root, '.codex');
  const log = path.join(root, 'codex-args.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    '[mcp_servers.trackly]\ncommand = "node"\nargs = ["old-server.js"]\n',
  );
  const codex = path.join(bin, 'codex');
  fs.writeFileSync(codex, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACKLY_TEST_LOG"\nexit 0\n', { mode: 0o755 });

  const result = await runCli(['agent', 'setup', '--client', 'codex', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    TRACKLY_TEST_LOG: log,
    CODEX_HOME: codexHome,
    PATH: `${bin}:${process.env.PATH}`,
  });

  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients[0].mcp.status, 'installed');
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    'mcp remove trackly',
    'mcp add trackly -- trackly mcp',
  ]);
});

test('agent setup repairs stale Claude metadata when no registered server exists', async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const claudeHome = path.join(root, '.claude');
  const log = path.join(root, 'claude-args.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, 'settings.json'),
    JSON.stringify({ mcpServers: { trackly: { command: 'node', args: ['old-server.js'] } } }),
  );
  const claude = path.join(bin, 'claude');
  fs.writeFileSync(claude, `#!/bin/sh
printf "%s\\n" "$*" >> "$TRACKLY_TEST_LOG"
if [ "$*" = "mcp remove --scope user trackly" ]; then
  printf "%s\\n" 'No MCP server named "trackly" in user scope' >&2
  exit 1
fi
exit 0
`, { mode: 0o755 });

  const result = await runCli(['agent', 'setup', '--client', 'claude', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    TRACKLY_TEST_LOG: log,
    CLAUDE_CONFIG_DIR: claudeHome,
    PATH: `${bin}:${process.env.PATH}`,
  });

  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients[0].mcp.status, 'installed');
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    'mcp remove --scope user trackly',
    'mcp add --scope user trackly -- trackly mcp',
  ]);
});

for (const removalError of [
  'permission denied',
  'Permission denied: No MCP server named "trackly" in user scope',
  'No MCP server named "trackly-old" in user scope',
  'No MCP server named "trackly" in user scope\npermission denied',
]) test(`agent setup does not ignore Claude MCP removal failure: ${removalError}`, async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const claudeHome = path.join(root, '.claude');
  const log = path.join(root, 'claude-args.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, 'settings.json'),
    JSON.stringify({ mcpServers: { trackly: { command: 'node', args: ['old-server.js'] } } }),
  );
  const claude = path.join(bin, 'claude');
  fs.writeFileSync(claude, `#!/bin/sh
printf "%s\\n" "$*" >> "$TRACKLY_TEST_LOG"
printf "%s\\n" '${removalError}' >&2
exit 1
`, { mode: 0o755 });

  const result = await runCli(['agent', 'setup', '--client', 'claude', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    TRACKLY_TEST_LOG: log,
    CLAUDE_CONFIG_DIR: claudeHome,
    PATH: `${bin}:${process.env.PATH}`,
  });

  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients[0].mcp.status, 'failed');
  assert.match(report.clients[0].mcp.error, new RegExp(removalError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'mcp remove --scope user trackly');
});

test('agent doctor rejects an installed skill with stale managed metadata', async (t) => {
  const root = createTempConfigDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const skill = path.join(codexHome, 'skills', 'trackly-apply');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'stale');
  fs.writeFileSync(path.join(skill, '.trackly-managed.json'), JSON.stringify({
    managedBy: 'trackly-cli',
    skill: 'trackly-apply',
    skillVersion: '0.9.0',
  }));
  const result = await runCli(['agent', 'doctor', '--json'], {
    TRACKLY_CONFIG_DIR: path.join(root, '.trackly'),
    CODEX_HOME: codexHome,
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients.find((client) => client.client === 'codex').installed, false);
  assert.equal(report.clients.find((client) => client.client === 'codex').installedSkillVersion, '0.9.0');
});
