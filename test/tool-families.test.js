'use strict';

// MCP tool families (close-ai #3619): one title and one description tag per tool name, applied
// at registration, and the same families in the same order in the README and the tool docs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babelParser = require('@babel/parser');
const { McpServer: SdkMcpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { createServer } = require('../mcp/server');
const families = require('../mcp/tool-families');

const ROOT = path.join(__dirname, '..');
const {
  LOCAL_ONLY_TOOL_NAMES, McpServer, TITLE_MAX_LENGTH, TOOL_ACTIONS, TOOL_FAMILIES,
  descriptionPrefix, plainDescription, toolFamily, toolTitle,
} = families;

const FAMILY_ORDER = [
  'Jobs', 'Companies', 'Network', 'Preferences', 'Profile', 'Job status', 'Tracker',
  'Trackly Apply (local)', 'Apply step', 'Trackly Apply (cloud)', 'Chat', 'Feedback',
];
const PROTOCOL_TAG = '[Trackly Apply · protocol step] ';
const PROTOCOL_SENTENCE = 'Called by the Trackly Apply skill during a run, using IDs from earlier steps, not as a standalone action.';

function registeredTools() {
  return createServer()._registeredTools;
}

test('the registry lists the approved families in catalog order', () => {
  assert.deepEqual(TOOL_FAMILIES.map(({ label }) => label), FAMILY_ORDER);
  const ids = new Set(TOOL_FAMILIES.map(({ id }) => id));
  for (const [name, [familyId, action]] of Object.entries(TOOL_ACTIONS)) {
    assert.ok(ids.has(familyId), `${name} names an unknown family ${familyId}`);
    assert.ok(typeof action === 'string' && action.trim() === action && action.length > 0, `${name} needs an action`);
    assert.ok(toolTitle(name).length <= TITLE_MAX_LENGTH, `${name} title is longer than ${TITLE_MAX_LENGTH}`);
    assert.doesNotMatch(action, /[[\]]/, `${name} action must not contain brackets`);
  }
  assert.equal(TOOL_FAMILIES.find(({ label }) => label === 'Apply step').tag, 'Trackly Apply · protocol step');
  for (const name of LOCAL_ONLY_TOOL_NAMES) assert.ok(toolFamily(name), `${name} needs a family`);
  assert.equal(toolTitle('trackly_lint_application_text'), 'Profile · Check answer text');
  for (const name of ['trackly_diagnose_local_path', 'trackly_validate_apply_resume_upload', 'trackly_validate_apply_tab_keep_set']) {
    assert.equal(toolFamily(name).protocol, true, name);
  }
  assert.equal(toolTitle('trackly_auto_apply'), 'Trackly Apply (cloud) · Request');
  assert.equal(toolTitle('trackly_update_status'), 'Job status · Mark applied, saved or dismissed');
  assert.equal(toolTitle('trackly_bind_apply_surface'), 'Apply step · Bind browser tab');
});

test('every npm tool lists its family title and exactly one description tag', () => {
  const tools = registeredTools();
  assert.equal(Object.keys(tools).length, 63);
  for (const [name, tool] of Object.entries(tools)) {
    const { family, protocol } = toolFamily(name) || {};
    assert.ok(family, `${name} has no family`);
    assert.equal(tool.title, toolTitle(name), name);
    assert.equal(tool.annotations?.title, tool.title, `${name} annotations.title must equal its title`);
    assert.ok(tool.description.startsWith(`[${family.tag}] `), `${name} must start with its family tag`);
    const plain = plainDescription(name, tool.description);
    assert.ok(plain.length > 0 && !plain.startsWith('['), `${name} must carry exactly one tag over a tag-free source description`);
    if (protocol) {
      assert.ok(tool.description.startsWith(`${PROTOCOL_TAG}${PROTOCOL_SENTENCE} `), `${name} must say it is a protocol step`);
    } else {
      assert.ok(!tool.description.includes(PROTOCOL_SENTENCE), `${name} is not a protocol step`);
    }
  }
  const local = tools.trackly_get_apply_queue.description;
  assert.match(local, /^\[Trackly Apply \(local\)\] Your own AI agent fills the form in your browser and stops before Submit; you submit\. /);
});

test('labels keep existing annotation hints', () => {
  const tools = registeredTools();
  assert.deepEqual(tools.trackly_retract_tracker_event.annotations, {
    title: 'Tracker · Undo an event', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
  });
});

test('a tool without a family cannot register', () => {
  const server = new McpServer({ name: 'families-test', version: '0.0.0' });
  assert.throws(() => server.tool('trackly_not_in_registry', 'x', {}, async () => ({ content: [] })), /has no family in mcp\/tool-families\.js/);
  assert.throws(() => server.registerTool('trackly_not_in_registry', { description: 'x', inputSchema: z.object({}) }, async () => ({ content: [] })), /has no family/);
  // The subclass changes nothing else about the SDK server.
  assert.ok(server instanceof SdkMcpServer);
});

test('the shared status story: applied also records the Tracker entry', () => {
  const tools = registeredTools();
  const status = plainDescription('trackly_update_status', tools.trackly_update_status.description);
  assert.match(status, /^Record a job's status on the user's job list: applied, saved or dismissed\. Applied is for an application the user submitted themselves\./);
  assert.match(status, /It also records the job on the Tracker/);
  assert.match(status, /returns trackerEntry \(created, linked, moved, existing, skipped or failed/);
  assert.match(status, /Saved and dismissed change only the job list and never the Tracker\./);
  assert.match(status, /trackly_update_tracker_stage/);
  assert.match(status, /trackly_add_tracker_note/);
  for (const name of ['trackly_create_tracker_application', 'trackly_update_tracker_stage']) {
    assert.doesNotMatch(tools[name].description, /only sets the job list status/, name);
  }
  for (const name of ['trackly_record_application_outcome', 'trackly_record_application_outcomes']) {
    assert.match(tools[name].description, /Trackly Apply run receipts? for the Trackly Apply skill \(review_ready, submitted, failed or blocked\)\. A submitted receipt also records the job on the Tracker/, name);
  }
});

test('registration call sites keep their shape and tag-free source descriptions', () => {
  // scripts/verify-hosted-contract.js reads registrations by argument position and compares
  // the source description literals with the hosted ones (whose helper keeps
  // trackly_certify_apply_batch_truth at five arguments). Labels come from the McpServer
  // subclass, so no call site changes: registerTool keeps (name, config, handler).
  for (const file of ['server.js', 'apply-tools.js']) {
    const source = fs.readFileSync(path.join(ROOT, 'mcp', file), 'utf8');
    const ast = babelParser.parse(source, { sourceType: 'unambiguous' });
    const calls = [];
    (function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
        && node.callee.object?.name === 'server' && ['tool', 'registerTool'].includes(node.callee.property?.name)) calls.push(node);
      for (const [key, child] of Object.entries(node)) if (key !== 'loc') visit(child);
    })(ast.program);
    assert.ok(calls.length > 0, file);
    for (const call of calls) {
      assert.equal(call.arguments[0]?.type, 'StringLiteral', `${file} registrations use static names`);
      const name = call.arguments[0].value;
      const registerTool = call.callee.property.name === 'registerTool';
      if (registerTool) assert.equal(call.arguments.length, 3, `${name} keeps registerTool(name, config, handler)`);
      const description = registerTool
        ? call.arguments[1]?.properties?.find((property) => property.key?.name === 'description')?.value
        : call.arguments[1];
      if (description?.type === 'StringLiteral') {
        assert.doesNotMatch(description.value, /^\[/, `${name} source description must stay tag-free`);
      }
    }
    if (file === 'apply-tools.js') {
      assert.ok(calls.some((call) => call.arguments[0].value === 'trackly_certify_apply_batch_truth'));
    }
  }
});

/** Family heading -> tool names listed under it, in document order. */
function sections(markdown, headingPrefix, itemPattern) {
  const out = [];
  for (const line of markdown.split('\n')) {
    if (line.startsWith(headingPrefix)) {
      out.push({ heading: line.slice(headingPrefix.length).trim(), names: [], lines: [] });
      continue;
    }
    const match = itemPattern.exec(line);
    if (match && out.length) {
      out.at(-1).names.push(match[1]);
      out.at(-1).lines.push(line);
    }
  }
  return out;
}

function assertFamilyGrouping(found, documentName) {
  const labels = found.map(({ heading }) => heading);
  const expectedOrder = FAMILY_ORDER.filter((label) => labels.includes(label));
  assert.deepEqual(labels, expectedOrder, `${documentName} family headings must follow the registry order`);
  const npm = new Set(Object.keys(registeredTools()));
  const listed = [];
  for (const { heading, names } of found) {
    for (const name of names) {
      assert.equal(toolFamily(name)?.family.label, heading, `${documentName} lists ${name} under ${heading}`);
      listed.push(name);
    }
  }
  assert.deepEqual([...listed].sort(), [...npm].sort(), `${documentName} must list every npm tool exactly once`);
}

test('README MCP Tools Reference groups every tool under its family, with registry titles', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const start = readme.indexOf('## MCP Tools Reference');
  const region = readme.slice(start, readme.indexOf('\n## ', start + 1));
  const found = sections(region, '### ', /^\| [^|]+ \| ([a-z_]+) \|/);
  assertFamilyGrouping(found, 'README');
  for (const { lines } of found) {
    for (const line of lines) {
      const [, title, name] = line.split('|').map((cell) => cell.trim());
      assert.equal(title, toolTitle(name), `README title for ${name}`);
    }
  }
});

test('docs/trackly-tools.md groups every tool under its family', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'trackly-tools.md'), 'utf8');
  const start = docs.indexOf('### Available Tools');
  const region = docs.slice(start, docs.indexOf('\n### ', start + 1));
  assertFamilyGrouping(sections(region, '#### ', /^- \*\*([a-z_]+)\*\*/), 'docs/trackly-tools.md');
});

test('descriptionPrefix is the tag plus the family sentence', () => {
  assert.equal(descriptionPrefix('trackly_get_job'), '[Jobs] ');
  assert.equal(descriptionPrefix('trackly_auto_apply'), '[Trackly Apply (cloud)] Trackly applies for you and nothing runs on your computer. ');
  assert.equal(descriptionPrefix('trackly_claim_apply_batch'), `${PROTOCOL_TAG}${PROTOCOL_SENTENCE} `);
});

test('the classic plugin release gates table carries every classic tool with its registry title', () => {
  const gates = fs.readFileSync(path.join(ROOT, 'plugins', 'trackly', 'RELEASE-GATES.md'), 'utf8');
  const rows = [...gates.matchAll(/^\| `(trackly_[a-z_]+)` \| ([^|]+) \| (?:true|false) \|/gm)];
  const classic = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'trackly', 'hosted-contract-fixture.json'), 'utf8'))
    .publicTools.map(([name]) => name);
  assert.deepEqual(rows.map(([, name]) => name).sort(), [...classic].sort());
  for (const [, name, title] of rows) assert.equal(title.trim(), toolTitle(name), name);
});
