'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../contracts/trackly-apply-tools.json');

const source = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');

function toolArguments(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const registration = new RegExp(`server\\.tool\\(\\s*['"]${escapedName}['"]`).exec(source);
  assert.ok(registration, `${name} is not registered`);
  const open = source.indexOf('(', registration.index);
  const args = [];
  let argStart = open + 1;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let quote = '';
  let escaped = false;
  for (let index = open + 1; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') parens++;
    else if (char === ')' && parens > 0) parens--;
    else if (char === '{') braces++;
    else if (char === '}') braces--;
    else if (char === '[') brackets++;
    else if (char === ']') brackets--;
    else if ((char === ',' || char === ')') && parens === 0 && braces === 0 && brackets === 0) {
      args.push(source.slice(argStart, index).trim());
      if (char === ')') break;
      argStart = index + 1;
    }
  }
  return args;
}

const normalizeSchema = (schema) => schema.replace(/\s+/g, '').replace(/,([}\]])/g, '$1');

test('local MCP Apply schemas match each complete versioned input schema', () => {
  assert.equal(contract.contractVersion, '2.0.0');
  for (const [name, expectedSchema] of Object.entries(contract.tools)) {
    const localSchema = typeof expectedSchema === 'string' ? expectedSchema : expectedSchema.local;
    assert.equal(normalizeSchema(toolArguments(name)[2]), localSchema, `${name} schema drifted`);
  }
});

test('local MCP has no uncontracted Trackly Apply tools', () => {
  const names = [...source.matchAll(/server\.tool\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((name) => name.includes('apply') || name.includes('application_profile') || name.includes('application_outcome') || name.includes('profile_onboarding') || name === 'trackly_prepare_resume' || name === 'trackly_verify_prepared_resume')
    .sort();
  assert.deepEqual(names, Object.keys(contract.tools).sort());
});

test('Apply contract makes maintenance resumable without duplicate runs or submission', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'trackly-apply', 'SKILL.md'), 'utf8');
  assert.match(skill, /Treat maintenance as resumable, never retryable/);
  assert.match(skill, /Do not call `trackly_start_apply_run` again/);
  assert.match(skill, /refetch `trackly_get_apply_protocol` and the application profile/);
  assert.match(skill, /Never click Submit/);

  assert.match(source, /If maintenance interrupts an existing run, do not call this tool again/);
  assert.match(source, /resume the existing agent_browser run/);
  assert.match(source, /Never start a duplicate run, blindly retry a mutation, or click Submit/);
});

test('Apply skill treats background-check authorization as explicit reusable consent', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'trackly-apply', 'SKILL.md'), 'utf8');
  assert.match(skill, /`consent\.background_check_if_advanced`/);
  assert.match(skill, /only when the form explicitly asks for consent to a background check if the candidate advances/);
  assert.match(skill, /If it is unknown, ask before selecting it/);
  assert.match(skill, /save the answer at the user's chosen scope/);
  assert.match(skill, /Never infer it from privacy, demographic, recruiting-data, general application, criminal-record, or professional-reference consent/);
  assert.match(skill, /Treat the latter two as separate unknown consent questions/);
});
