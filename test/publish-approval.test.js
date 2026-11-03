import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("publishing to npm waits for the npm-publish approval", () => {
  const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  const publish = workflow.slice(workflow.indexOf("
  publish:"));
  assert.match(publish, /
    environment: npm-publish?
/);
  assert.match(publish, /npm publish/);
});
