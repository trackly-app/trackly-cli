const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("publishing to npm waits for the npm-publish approval", () => {
  const workflow = readFileSync(join(__dirname, "../.github/workflows/publish.yml"), "utf8");
  const rest = workflow.slice(workflow.indexOf("\n  publish:") + 1);
  const nextJob = rest.search(/\n  [A-Za-z0-9_-]+:\r?\n/);
  const publish = nextJob === -1 ? rest : rest.slice(0, nextJob);
  assert.match(publish, /\n    environment: npm-publish\r?\n/);
  assert.match(publish, /npm publish/);
});

test("the post-publish attestation check waits for npm's asynchronous processing", () => {
  const workflow = readFileSync(join(__dirname, "../.github/workflows/publish.yml"), "utf8");
  const start = workflow.indexOf("- name: Verify npm attestations (post-publish)");
  assert.notEqual(start, -1);
  const step = workflow.slice(start, workflow.indexOf("\n      - name:", start + 1));
  const attempts = Number(step.match(/ATTEMPTS=(\d+)/)[1]);
  const interval = Number(step.match(/INTERVAL=(\d+)/)[1]);
  // 0.26.0 became visible about four minutes after publish; a 30s check failed a good release.
  assert.ok(attempts * interval >= 600, `attestation wait is only ${attempts * interval}s`);
  const timeout = Number(step.match(/timeout-minutes: (\d+)/)[1]);
  assert.ok(timeout * 60 > attempts * interval, "the step timeout must exceed the polling window");
  // The loop is driven by those values, bounded by wall-clock time, and each npm call is capped.
  assert.match(step, /for i in \$\(seq 1 "\$\{ATTEMPTS\}"\); do/);
  assert.match(step, /sleep "\$\{INTERVAL\}"/);
  assert.match(step, /DEADLINE=\$\(\(SECONDS \+ ATTEMPTS \* INTERVAL\)\)/);
  assert.match(step, /\[ "\$\{SECONDS\}" -ge "\$\{DEADLINE\}" \]/);
  assert.equal((step.match(/npm view \$\{NPM_VIEW_FLAGS\}/g) || []).length, 2);
  assert.match(step, /--fetch-timeout=\d+/);
  // The publish job must outlast the step's own timeout.
  const rest = workflow.slice(workflow.indexOf("\n  publish:") + 1);
  const jobTimeout = Number(rest.match(/\n    timeout-minutes: (\d+)/)[1]);
  assert.ok(jobTimeout >= timeout + 8, `publish job timeout ${jobTimeout}m leaves too little room after the ${timeout}m step`);
  // The MCP Registry steps still run only after the attestation check passes.
  assert.ok(workflow.indexOf("Publish to MCP Registry") > start);
});
