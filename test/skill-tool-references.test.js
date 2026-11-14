'use strict';

// Skills guard (close-ai #3619, U8): titles and descriptions change, tool names never do.
// Every trackly_* name a shipped skill mentions must resolve on the catalog of the surface
// that skill ships with, so a relabel or a typo cannot leave a skill calling a missing tool.
//   - npm skill (skills/trackly-apply)                 -> tools mcp/server.js registers
//   - Claude skill and plugin (plugins/trackly-claude) -> captured Claude catalog (listing/claude/tools.json)
//   - classic Codex plugin skills (plugins/trackly)    -> captured classic catalog (hosted-contract-fixture.json publicTools)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../mcp/server');

const ROOT = path.join(__dirname, '..');

function filesBelow(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `skill trees must not contain symbolic links: ${absolute}`);
    if (entry.isDirectory()) files.push(...filesBelow(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort();
}

/** Every trackly_* token in a skill tree, with the files that name it. */
function toolReferences(directory) {
  const references = new Map();
  for (const file of filesBelow(directory)) {
    if (!/\.(md|ya?ml|json|txt)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [name] of text.matchAll(/\btrackly_[a-z0-9_]+\b/g)) {
      if (!references.has(name)) references.set(name, new Set());
      references.get(name).add(path.relative(directory, file));
    }
  }
  return references;
}

// trackly_* tokens that are values, not tools. Keep this list short and explain each entry.
const NON_TOOL_TOKENS = Object.freeze([
  // An authorized-origin policy value the Apply protocol returns (origin trust for employer careers sources).
  'trackly_employer_source_exact_origin',
]);

function unresolved(directory, catalog) {
  const names = new Set([...catalog, ...NON_TOOL_TOKENS]);
  return [...toolReferences(directory)]
    .filter(([name]) => !names.has(name))
    .map(([name, files]) => `${name} (${[...files].join(', ')})`);
}

const npmCatalog = () => Object.keys(createServer()._registeredTools);
const claudeCatalog = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/trackly/listing/claude/tools.json'), 'utf8'))
  .tools.map(({ name }) => name);
const classicCatalog = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/trackly/hosted-contract-fixture.json'), 'utf8'))
  .publicTools.map(([name]) => name);

const SURFACES = [
  { skill: 'skills/trackly-apply', catalog: npmCatalog, label: 'npm MCP' },
  { skill: 'plugins/trackly-claude', catalog: claudeCatalog, label: 'Claude connector' },
  { skill: 'plugins/trackly/skills', catalog: classicCatalog, label: 'classic Codex plugin' },
];

for (const { skill, catalog, label } of SURFACES) {
  test(`${skill} names only tools the ${label} lists`, () => {
    const directory = path.join(ROOT, skill);
    assert.ok(toolReferences(directory).size > 0, `${skill} must reference at least one tool (the scan is not vacuous)`);
    assert.deepEqual(unresolved(directory, catalog()), [], `${skill} names tools the ${label} does not list`);
  });
}

test('a misspelled tool name in a skill fails the reference check', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-skill-refs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'references'));
  fs.writeFileSync(path.join(directory, 'SKILL.md'), 'Call `trackly_get_apply_protocol` first.\n');
  fs.writeFileSync(path.join(directory, 'references', 'steps.md'), 'Then call `trackly_bind_apply_surfce`.\n');
  for (const { catalog } of SURFACES) {
    assert.deepEqual(unresolved(directory, [...catalog(), 'trackly_get_apply_protocol']), ['trackly_bind_apply_surfce (references/steps.md)']);
  }
});

test('no shipped skill says "cloud auto-apply" or adds a Tracker entry after a recorded application', () => {
  for (const { skill } of SURFACES) {
    for (const file of filesBelow(path.join(ROOT, skill)).filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(file, 'utf8');
      const where = path.relative(ROOT, file);
      assert.doesNotMatch(text, /cloud auto-apply/i, `${where} must say "Trackly Apply (cloud)"`);
      for (const line of text.split('\n').filter((candidate) => candidate.includes('trackly_create_tracker_application'))) {
        assert.match(line, /\bnever\b|not Trackly jobs/i, `${where} may name trackly_create_tracker_application only to rule it out after applied: ${line}`);
      }
    }
  }
});

module.exports = { toolReferences, unresolved };
