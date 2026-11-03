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
