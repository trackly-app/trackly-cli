const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Executes the real "Reconcile CI_RUNNER_LINUX" step in the outage state it
// exists for. The fake gh mirrors gh >= 2.100, which rejects --slurp with --jq:
// on 2026-10-03 that made the failover set the variable but rerun nothing.
// Ported from trackly-app/close-ai src/__tests__/ci-runner-autopilot-rerun.test.ts.

// Extract a step's `run: |` block without a YAML dependency (byte-identical to
// js-yaml on this workflow).
function stepRun(text, stepName) {
  const lines = text.split('\n');
  const nameAt = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (nameAt < 0) throw new Error(`step not found: ${stepName}`);
  const runAt = lines.findIndex((line, i) => i > nameAt && /^\s*run: \|\s*$/.test(line));
  if (runAt < 0) throw new Error(`run block not found: ${stepName}`);
  const keyIndent = lines[runAt].search(/\S/);
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  return body.map((line) => line.slice(indent)).join('\n') + '\n';
}

const reconcile = {
  run: stepRun(
    fs.readFileSync(path.join(__dirname, '../.github/workflows/ci-runner-autopilot.yml'), 'utf8'),
    'Reconcile CI_RUNNER_LINUX with hosted health',
  ),
};

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
// The step uses GNU `date -d`; execute it only where that exists (CI is Linux).
const itExec = (name, fn) => it(name, { skip: process.platform !== 'linux' }, fn);

// Listing rows (workflow_id, head_branch, created_at, run id, conclusion), with
// created_at relative to now so the 3h "may age out" edge stays stable:
//  10/feature-a: 501 refused (60m ago), 502 refused (55m ago, newest)  -> rerun 502
//  10/feature-b: 503 failed with a runner (59m ago, real failure)       -> skip
//  20/feature-a: 504 refused (58m ago)                                  -> rerun 504
//  30/feature-c: 506 refused, newer 507 still pending                   -> skip group
//  40/feature-d: 508 refused, newer 509 succeeded                       -> skip group
//  50/feature-e: 511 refused and 512 pending in the same second         -> skip group (id breaks tie)
// Page 2 (502 and the 40/50 groups) is returned only when --paginate is passed.
// FAKE_EXTRA_REFUSED=N adds N refused groups (workflow 0N so they group before
// 10, run 9000+N, 35m ago or 3h20m ago with FAKE_EXTRA_OLD=1) to reach the cap.
// FAKE_FILLER=N adds N successful runs 2h30m ago (workflow 99, branches f1..fN,
// never qualifying) to reach the API's 1000-row cap in that one-hour window;
// FAKE_FILLER_B=N adds N more 4h30m ago, in a different window.
// Rows are emitted only inside the queried created=FROM..TO window.
const FAKE_GH = `#!/bin/bash
echo "$*" >> "$GH_CALL_LOG"
args=" $* "
if [[ "$args" == *" --slurp "* && "$args" == *" --jq "* ]]; then
  echo "the \\\`--slurp\\\` option is not supported with \\\`--jq\\\` or \\\`--template\\\`" >&2
  exit 1
fi
now=$(date -u +%s)
lo=0; hi=$now
if [[ "$args" =~ created=([0-9TZ:-]+)\\.\\.([0-9TZ:-]+) ]]; then
  lo=$(date -u -d "\${BASH_REMATCH[1]}" +%s); hi=$(date -u -d "\${BASH_REMATCH[2]}" +%s)
fi
# row WORKFLOW BRANCH MINUTES_AGO RUN_ID CONCLUSION, only inside the window.
row() {
  local t=$((now - $3 * 60))
  (( t >= lo && t <= hi )) || return 0
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$(date -u -d "@$t" +%Y-%m-%dT%H:%M:%SZ)" "$4" "$5"
}
case "$args" in
  *"actions/variables/CI_RUNNER_LINUX"*)
    if [[ "$args" == *"-X DELETE"* ]]; then exit 0; fi
    if [[ -n "$FAKE_CUR" ]]; then echo "$FAKE_CUR"; exit 0; fi
    echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  *"-X POST"*"actions/variables"*) echo '{}'; exit 0 ;;
  *"actions/runs?event=pull_request"*)
    [[ "$FAKE_LIST_FAILS" == 1 ]] && { echo "gh: Server Error (HTTP 502)" >&2; exit 1; }
    [[ "$FAKE_EMPTY_LIST" == 1 ]] && exit 0
    row 10 feature-a 60 501 failure
    row 10 feature-b 59 503 failure
    row 20 feature-a 58 504 startup_failure
    row 30 feature-c 70 506 failure
    row 30 feature-c 50 507 pending
    if [[ "$args" == *" --paginate "* ]]; then
      tie=40
      row 10 feature-a 55 502 failure
      row 40 feature-d 80 508 failure
      row 40 feature-d 45 509 success
      row 50 feature-e "$tie" 511 failure
      row 50 feature-e "$tie" 512 pending
    fi
    extra_age=35; [[ "$FAKE_EXTRA_OLD" == 1 ]] && extra_age=200
    for ((n = 1; n <= \${FAKE_EXTRA_REFUSED:-0}; n++)); do
      row "0$n" extra "$extra_age" "$((9000 + n))" failure
    done
    [[ "$FAKE_EXTRA_REAL" == 1 ]] && row 80 late 20 8001 failure
    for ((n = 1; n <= \${FAKE_FILLER:-0}; n++)); do
      row 99 "f$n" 150 "$((20000 + n))" success
    done
    for ((n = 1; n <= \${FAKE_FILLER_B:-0}; n++)); do
      row 98 "g$n" 270 "$((30000 + n))" success
    done
    exit 0 ;;
  *"actions/runs/502/jobs?per_page=100"*) [[ "$FAKE_JOBS_FAIL" == 502 ]] && { echo "gh: HTTP 500" >&2; exit 1; }; echo 6 ;;
  *"actions/runs/503/jobs"*) echo 0 ;;
  # 504's refused job is on page 2: only a paginated lookup that sums pages finds it.
  *"actions/runs/504/jobs"*) if [[ "$args" == *" --paginate "* ]]; then echo 0; echo 1; else echo 0; fi ;;
  *"actions/runs/9"[0-9][0-9][0-9]"/jobs"*) echo 1 ;;
  *"actions/runs/8001/jobs"*) echo 0 ;;
  *"rerun-failed-jobs"*)
    [[ -n "$FAKE_RERUN_FAIL" && "$args" == *"runs/$FAKE_RERUN_FAIL/"* ]] && { echo "gh: HTTP 403" >&2; exit 1; }
    echo '{}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
`;

const FAKE_CURL = `#!/bin/bash
echo "$*" >> "$CURL_CALL_LOG"
`;

const dirs = [];
after(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function runReconcile(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), FAKE_CURL, { mode: 0o755 });
  const log = path.join(dir, 'calls.log');
  const curlLog = path.join(dir, 'curl.log');
  fs.writeFileSync(log, '');
  fs.writeFileSync(curlLog, '');
  // Re-prepend inside the script: some shells re-order PATH at startup.
  const script = `export PATH="${dir}:$PATH"\n` + reconcile.run
    .replaceAll('${{ github.repository }}', 'trackly-app/close-ai')
    .replaceAll('${{ needs.hosted-probe.result }}', env.PROBE ?? 'failure')
    .replaceAll('${{ github.run_id }}', '4242');
  // GitHub Actions runs `run:` blocks with `bash --noprofile --norc -eo pipefail`.
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GH_CALL_LOG: log,
      CURL_CALL_LOG: curlLog,
      VARS_TOKEN: 'fake',
      GH_TOKEN: 'fake',
      FALLBACK_LABEL: 'runs-on=trackly-fallback/runner=2cpu-linux-x64',
      SLACK_WEBHOOK_CRITICAL: '',
      ...env,
    },
  });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  const rerunOrder = calls.filter((call) => call.includes('rerun-failed-jobs'))
    .map((call) => call.match(/runs\/(\d+)\//)?.[1] ?? '');
  const deleted = calls.some((call) => call.includes('-X DELETE repos/trackly-app/close-ai/actions/variables/CI_RUNNER_LINUX'));
  return { ...result, calls, deleted, rerunOrder, reruns: [...rerunOrder].sort(), curl: fs.readFileSync(curlLog, 'utf8') };
}

const FALLBACK = 'runs-on=trackly-fallback/runner=2cpu-linux-x64';
const SLACK = 'https://hooks.example.test/x';
const JQ_FILTER = '.workflow_runs[] | [((.workflow_id|tostring) + ":" + (.head_repository.full_name // "")), .head_branch, .created_at, (.id|tostring), (.conclusion // "pending")] | @tsv';

describe('ci-runner-autopilot refused-run recovery', () => {
  it('has the reconcile step this test executes', () => {
    assert.ok((reconcile.run).includes('rerun_refused_pr_runs'), `expected ${JSON.stringify('rerun_refused_pr_runs')} in:\n${reconcile.run}`);
  });

  it('never combines --slurp with --jq in a gh call', () => {
    const code = reconcile.run.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    for (const line of code.split('\n')) {
      if (line.includes('--slurp')) assert.ok(!(line).includes('--jq'), `expected no ${JSON.stringify('--jq')} in:\n${line}`);
    }
    assert.doesNotMatch(code, /--slurp[^\n]*\\\n[^\n]*--jq/);
  });

  it('pins the five TSV fields the shell grouping consumes and the six one-hour windows', () => {
    assert.equal(reconcile.run.match(/--jq '(\.workflow_runs\[\][^']*)'/)?.[1], JQ_FILTER);
    assert.ok((reconcile.run).includes('for w in 6 5 4 3 2 1; do'), `expected ${JSON.stringify('for w in 6 5 4 3 2 1; do')} in:\n${reconcile.run}`);
  });

  it('produces those rows from a real runs page (needs jq)', { skip: !hasJq }, () => {
    const repo = { full_name: 'trackly-app/trackly-cli' };
    const page = JSON.stringify({ workflow_runs: [
      { workflow_id: 10, head_branch: 'feature-a', head_repository: repo, created_at: '2026-10-04T06:34:00Z', id: 502, conclusion: 'failure' },
      { workflow_id: 10, head_branch: 'feature-a', head_repository: repo, created_at: '2026-10-04T06:35:00Z', id: 505, conclusion: null },
      { workflow_id: 20, head_branch: 'feature-b', head_repository: repo, created_at: '2026-10-04T06:31:00Z', id: 504, conclusion: 'startup_failure' },
      // Two fork PRs from same-named branches must land in different groups.
      { workflow_id: 30, head_branch: 'main', head_repository: { full_name: 'fork-a/trackly-cli' }, created_at: '2026-10-04T06:36:00Z', id: 601, conclusion: 'failure' },
      { workflow_id: 30, head_branch: 'main', head_repository: { full_name: 'fork-b/trackly-cli' }, created_at: '2026-10-04T06:37:00Z', id: 602, conclusion: 'failure' },
      { workflow_id: 40, head_branch: 'gone', head_repository: null, created_at: '2026-10-04T06:38:00Z', id: 603, conclusion: 'failure' },
    ] });
    const out = spawnSync('jq', ['-r', JQ_FILTER], { input: page, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(out.stdout.trim().split('\n'), [
      '10:trackly-app/trackly-cli\tfeature-a\t2026-10-04T06:34:00Z\t502\tfailure',
      '10:trackly-app/trackly-cli\tfeature-a\t2026-10-04T06:35:00Z\t505\tpending',
      '20:trackly-app/trackly-cli\tfeature-b\t2026-10-04T06:31:00Z\t504\tstartup_failure',
      '30:fork-a/trackly-cli\tmain\t2026-10-04T06:36:00Z\t601\tfailure',
      '30:fork-b/trackly-cli\tmain\t2026-10-04T06:37:00Z\t602\tfailure',
      '40:\tgone\t2026-10-04T06:38:00Z\t603\tfailure',
    ]);
  });

  itExec('fails over and reruns only refused runs that are the newest in their group', () => {
    const result = runReconcile({ PROBE: 'failure' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok((result.stdout).includes('failing over to RunsOn'), `expected ${JSON.stringify('failing over to RunsOn')} in:\n${result.stdout}`);
    assert.equal(result.calls.some((call) => call.includes('-X POST repos/trackly-app/close-ai/actions/variables')), true);
    // 502 is only on page 2: dropping --paginate would miss it.
    assert.deepEqual(result.reruns, ['502', '504']);
    assert.deepEqual(result.rerunOrder, ['504', '502']);
    assert.ok((result.stdout).includes('run 503: failures are real'), `expected ${JSON.stringify('run 503: failures are real')} in:\n${result.stdout}`);
    assert.equal(result.calls.some((call) => /runs\/(501|506|507|508|509|511|512)\/jobs/.test(call)), false);
    assert.ok(!(result.stdout).includes('::warning::'), `expected no ${JSON.stringify('::warning::')} in:\n${result.stdout}`);
    assert.ok(!(result.stdout).includes('INCOMPLETE'), `expected no ${JSON.stringify('INCOMPLETE')} in:\n${result.stdout}`);
  });

  itExec('keeps sweeping refused runs while the outage continues', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_CUR: FALLBACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(result.reruns, ['502', '504']);
  });

  itExec('sweeps outage-tail victims, then flips back to hosted', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.deleted, true);
    assert.deepEqual(result.reruns, ['502', '504']);
    // The DELETE comes after the last rerun, so a failed sweep keeps the fallback.
    const lastRerun = result.calls.map((call) => call.includes('rerun-failed-jobs')).lastIndexOf(true);
    assert.ok(result.calls.findIndex((call) => call.includes('-X DELETE')) > lastRerun, 'expected greater');
  });

  itExec('keeps the fallback when the final sweep fails, and the next tick finishes recovery', () => {
    const failed = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_JOBS_FAIL: '502', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(failed.status, 0);
    assert.equal(failed.deleted, false);
    assert.ok((failed.stdout).includes('CI_RUNNER_LINUX stays on RunsOn and the next tick sweeps again'), `expected ${JSON.stringify('CI_RUNNER_LINUX stays on RunsOn and the next tick sweeps again')} in:\n${failed.stdout}`);
    // Next tick: still healthy and the fallback is still set, so it sweeps again.
    const next = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(next.status, 0, next.stderr + next.stdout);
    assert.deepEqual(next.reruns, ['502', '504']);
    assert.equal(next.deleted, true);
  });

  itExec('stops at the per-tick cap oldest-first, logs how many remain, and stays quiet mid-outage', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_EXTRA_REFUSED: '12', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    // 14 refused candidates, cap 10. The extras group before workflow 10 but are
    // newer, so oldest-first puts 504 and 502 ahead of them.
    assert.equal((result.rerunOrder).length, 10);
    assert.deepEqual(result.rerunOrder.slice(0, 2), ['504', '502']);
    assert.ok((result.stdout).includes('rerun cap reached (10); 4 refused run(s) left for the next tick'), `expected ${JSON.stringify('rerun cap reached (10); 4 refused run(s) left for the next tick')} in:\n${result.stdout}`);
    // A capped backlog that will not age out before the next tick drains quietly.
    assert.ok(!(result.curl).includes('INCOMPLETE'), `expected no ${JSON.stringify('INCOMPLETE')} in:\n${result.curl}`);
  });

  itExec('alerts mid-outage when capped refused runs are about to age out of the lookback', () => {
    const result = runReconcile({
      PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_EXTRA_REFUSED: '12', FAKE_EXTRA_OLD: '1', SLACK_WEBHOOK_CRITICAL: SLACK,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    // The 12 old extras go first; 10 rerun, 2 old ones are capped and expiring.
    assert.equal((result.rerunOrder).length, 10);
    assert.ok((result.stdout).includes('2 capped refused run(s) may age out of the lookback'), `expected ${JSON.stringify('2 capped refused run(s) may age out of the lookback')} in:\n${result.stdout}`);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 2 candidate(s)'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 2 candidate(s)')} in:\n${result.curl}`);
  });

  itExec('never counts a real failure past the cap as unrecovered', () => {
    const result = runReconcile({
      PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_EXTRA_REFUSED: '8', FAKE_EXTRA_REAL: '1', SLACK_WEBHOOK_CRITICAL: SLACK,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal((result.reruns).length, 10);
    assert.ok((result.stdout).includes('run 8001: failures are real'), `expected ${JSON.stringify('run 8001: failures are real')} in:\n${result.stdout}`);
    assert.ok(!(result.curl).includes('INCOMPLETE'), `expected no ${JSON.stringify('INCOMPLETE')} in:\n${result.curl}`);
  });

  itExec('treats a tick with no pull_request runs as a clean no-op', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_EMPTY_LIST: '1' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(result.reruns, []);
    assert.ok(!(result.stdout).includes('::warning::'), `expected no ${JSON.stringify('::warning::')} in:\n${result.stdout}`);
  });

  itExec('reports an hourly listing that reached the API result cap', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_FILLER: '1000', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok((result.stdout).includes("reached the API's 1000-run cap; older runs in that hour may not have been scanned"), `expected ${JSON.stringify("reached the API's 1000-run cap; older runs in that hour may not have been scanned")} in:\n${result.stdout}`);
    assert.deepEqual(result.reruns, ['502', '504']);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 0 candidate(s) not recovered; an hourly run listing reached the 1000-run cap'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 0 candidate(s) not recovered; an hourly run listing reached the 1000-run cap')} in:\n${result.curl}`);
  });

  itExec('keeps the fallback when a final-sweep hourly listing reached the cap', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_FILLER: '1000', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(result.status, 0);
    assert.equal(result.deleted, false);
    assert.ok((result.stdout).includes('::error::final flip-back sweep left refused runs unrecovered or unscanned'), `expected ${JSON.stringify('::error::final flip-back sweep left refused runs unrecovered or unscanned')} in:\n${result.stdout}`);
  });

  itExec('flips back normally one run below the hourly cap', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_FILLER: '999', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(!(result.stdout).includes('1000-run cap'), `expected no ${JSON.stringify('1000-run cap')} in:\n${result.stdout}`);
    assert.equal(result.deleted, true);
  });

  itExec('scans over 1000 runs across the lookback when no hour reaches the cap', () => {
    const result = runReconcile({
      PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_FILLER: '990', FAKE_FILLER_B: '990',
      FAKE_EXTRA_REFUSED: '2', FAKE_EXTRA_OLD: '1', SLACK_WEBHOOK_CRITICAL: SLACK,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(!(result.stdout).includes('1000-run cap'), `expected no ${JSON.stringify('1000-run cap')} in:\n${result.stdout}`);
    // The 3h20m-old refused runs are rerun even though about 2000 runs are newer or older.
    assert.deepEqual(result.reruns, ['502', '504', '9001', '9002']);
    assert.equal(result.deleted, true);
  });

  itExec('alerts mid-outage, without failing the step, when a rerun request is refused', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_CUR: FALLBACK, FAKE_RERUN_FAIL: '504', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok((result.stdout).includes('run 504: rerun request failed'), `expected ${JSON.stringify('run 504: rerun request failed')} in:\n${result.stdout}`);
    assert.ok(!(result.stdout).includes('::error::'), `expected no ${JSON.stringify('::error::')} in:\n${result.stdout}`);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 1 candidate'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 1 candidate')} in:\n${result.curl}`);
  });

  itExec('gives the one-shot flip-back sweep a larger cap', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_EXTRA_REFUSED: '12', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal((result.reruns).length, 14);
    assert.ok(!(result.curl).includes('INCOMPLETE'), `expected no ${JSON.stringify('INCOMPLETE')} in:\n${result.curl}`);
  });

  itExec('alerts and fails the final sweep when even its larger cap leaves refused runs', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_EXTRA_REFUSED: '50', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(result.status, 0);
    assert.equal((result.reruns).length, 50);
    assert.ok((result.stdout).includes('rerun cap reached (50); 2 refused run(s) left for the next tick'), `expected ${JSON.stringify('rerun cap reached (50); 2 refused run(s) left for the next tick')} in:\n${result.stdout}`);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 2 candidate(s)'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 2 candidate(s)')} in:\n${result.curl}`);
    assert.equal(result.deleted, false);
  });

  itExec('fails the flip-back sweep red when a rerun request is refused', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_RERUN_FAIL: '504', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(result.status, 0);
    assert.ok((result.stdout).includes('run 504: rerun request failed'), `expected ${JSON.stringify('run 504: rerun request failed')} in:\n${result.stdout}`);
    assert.ok((result.stdout).includes('::error::final flip-back sweep left refused runs unrecovered'), `expected ${JSON.stringify('::error::final flip-back sweep left refused runs unrecovered')} in:\n${result.stdout}`);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 1 candidate'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 1 candidate')} in:\n${result.curl}`);
    assert.equal(result.deleted, false);
  });

  itExec('skips one candidate whose jobs cannot be read, keeps sweeping, and alerts', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_JOBS_FAIL: '502', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok((result.stdout).includes('::warning::run 502: could not read its jobs'), `expected ${JSON.stringify('::warning::run 502: could not read its jobs')} in:\n${result.stdout}`);
    assert.deepEqual(result.reruns, ['504']);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE: 1 candidate'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE: 1 candidate')} in:\n${result.curl}`);
  });

  itExec('fails the one-shot flip-back sweep red when it leaves a refused run behind', () => {
    const result = runReconcile({ PROBE: 'success', FAKE_CUR: FALLBACK, FAKE_JOBS_FAIL: '502', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(result.status, 0);
    assert.ok((result.stdout).includes('::error::final flip-back sweep left refused runs unrecovered'), `expected ${JSON.stringify('::error::final flip-back sweep left refused runs unrecovered')} in:\n${result.stdout}`);
    assert.deepEqual(result.reruns, ['504']);
    assert.ok((result.curl).includes('refused-run recovery INCOMPLETE'), `expected ${JSON.stringify('refused-run recovery INCOMPLETE')} in:\n${result.curl}`);
    assert.equal(result.deleted, false);
  });

  itExec('fails the step loudly and alerts when the run listing cannot be read', () => {
    const result = runReconcile({ PROBE: 'failure', FAKE_LIST_FAILS: '1', SLACK_WEBHOOK_CRITICAL: SLACK });
    assert.notEqual(result.status, 0);
    assert.ok((result.stdout).includes('::error::could not list pull_request runs for refused-run recovery'), `expected ${JSON.stringify('::error::could not list pull_request runs for refused-run recovery')} in:\n${result.stdout}`);
    assert.deepEqual(result.reruns, []);
    assert.ok((result.curl).includes('refused-run recovery FAILED'), `expected ${JSON.stringify('refused-run recovery FAILED')} in:\n${result.curl}`);
  });
});
