'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../contracts/trackly-apply-tools.json');

const source = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');

function toolBlock(name) {
  const start = source.indexOf(`'${name}'`);
  assert.notEqual(start, -1, `${name} is not registered`);
  const nextTool = source.indexOf('server.tool(', start);
  const nextPrompt = source.indexOf('server.registerPrompt(', start);
  const ends = [nextTool, nextPrompt].filter((value) => value !== -1);
  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

test('local MCP Apply schemas match the versioned contract fragments', () => {
  assert.equal(contract.contractVersion, '1.0.0');
  for (const [name, fragments] of Object.entries(contract.tools)) {
    const block = toolBlock(name);
    for (const fragment of fragments) assert.ok(block.includes(fragment), `${name} missing schema fragment: ${fragment}`);
  }
});

test('local MCP has no uncontracted Trackly Apply tools', () => {
  const names = [...source.matchAll(/server\.tool\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((name) => name.includes('apply') || name.includes('application_profile') || name.includes('application_outcome') || name.includes('profile_onboarding') || name === 'trackly_prepare_resume')
    .sort();
  assert.deepEqual(names, Object.keys(contract.tools).sort());
});
