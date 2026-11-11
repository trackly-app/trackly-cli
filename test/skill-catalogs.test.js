'use strict';

// Every skill this package ships may name only tools its own surface lists, so a wording change
// can never point an installed agent at a tool that does not exist there. Tool names never change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../mcp/server');

const ROOT = path.join(__dirname, '..');
const SKILLS = {
  npm: path.join(ROOT, 'skills', 'trackly-apply'),
  codex: path.join(ROOT, 'plugins', 'trackly', 'skills'),
  claude: path.join(ROOT, 'plugins', 'trackly-claude', 'skills', 'trackly-apply'),
};

function textFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(absolute);
    return /\.(md|ya?ml|js)$/.test(entry.name) ? [absolute] : [];
  });
}

function referencedTools(directory) {
  const names = new Set();
  for (const file of textFiles(directory)) {
    for (const [token] of fs.readFileSync(file, 'utf8').matchAll(/\btrackly_[a-z0-9_]+\b/g)) {
      if (!NON_TOOL_VALUES.has(token)) names.add(token);
    }
  }
  return names;
}

// Protocol values that share the trackly_ prefix but are not tool names.
const NON_TOOL_VALUES = new Set(['trackly_employer_source_exact_origin']);

const json = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

test('the npm Trackly Apply (local) skill names only tools the npm MCP registers', () => {
  const catalog = new Set(Object.keys(createServer()._registeredTools));
  const referenced = referencedTools(SKILLS.npm);
  assert.ok(referenced.size >= 25, `the skill should drive most of the catalog (named ${referenced.size})`);
  assert.deepEqual([...referenced].filter((name) => !catalog.has(name)).sort(), []);
  // It names the other two ways to apply so an agent picks the right one.
  for (const name of ['trackly_auto_apply', 'trackly_auto_apply_status', 'trackly_update_status']) {
    assert.ok(referenced.has(name), name);
  }
});

test('the Codex plugin skills name only tools of the classic facade', () => {
  const lock = json('plugins/trackly/skill-lock.json');
  const fixture = json('plugins/trackly/hosted-contract-fixture.json');
  const facade = new Set(lock.publicToolAllowlist);
  assert.deepEqual([...facade].sort(), fixture.publicTools.map(([name]) => name).sort());
  assert.deepEqual([...referencedTools(SKILLS.codex)].filter((name) => !facade.has(name)).sort(), []);
});

test('the Claude skill names only tools the Claude connector lists, so never Trackly Apply (cloud)', () => {
  const catalog = new Set(json('plugins/trackly/listing/claude/tools.json').tools.map(({ name }) => name));
  const referenced = referencedTools(SKILLS.claude);
  assert.deepEqual([...referenced].filter((name) => !catalog.has(name)).sort(), []);
  assert.equal(referenced.has('trackly_auto_apply'), false);
});

test('shipped skills use the Trackly Apply (local) and Trackly Apply (cloud) family names', () => {
  for (const [surface, directory] of Object.entries(SKILLS)) {
    for (const file of textFiles(directory)) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(ROOT, file);
      assert.doesNotMatch(text, /cloud auto-apply|auto-apply request/i, `${surface}: ${relative}`);
      // A bare product name in a title or the skill description must carry its family.
      for (const line of text.split('\n').filter((value) => /^(#|description:|  display_name:)/.test(value))) {
        for (const match of line.matchAll(/\b[Tt]rackly Apply\b(?! \((local|cloud)\))/g)) {
          assert.fail(`${surface}: ${relative} heading or description says "${match[0]}" without (local) or (cloud): ${line}`);
        }
      }
    }
  }
});
