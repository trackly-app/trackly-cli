const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("publishing to npm waits for the npm-publish approval", () => {
  const workflow = readFileSync(join(__dirname, "../.github/workflows/publish.yml"), "utf8");
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  assert.match(publish, /\n    environment: npm-publish\r?\n/);
  assert.match(publish, /npm publish/);
});
