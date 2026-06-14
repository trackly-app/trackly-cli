'use strict';

// Replaces the previously-vacuous docs-drift "all MCP tools documented" CI step.
//
// The old check (`.github/workflows/docs-drift.yml`) extracted tool names with
// `grep "server.tool(" | grep -oP "'[^']+'"` — but in mcp/server.js the
// `server.tool(` call and the `'tool_name'` literal are on SEPARATE lines, and
// grep is line-oriented, so the extraction returned ZERO tools. The for-loop
// then iterated nothing and the gate trivially passed. That is exactly how the
// 11th tool (trackly_request_company) reached main undocumented.
//
// JS regex `\s*` DOES match across newlines (unlike grep), so this extraction is
// correct. We also cross-check the extracted count against the raw `server.tool(`
// call count so a future quote-style change can't silently drop a tool, and a
// fixture case proves the checker actually fails on an undocumented tool.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// --- pure helpers (also exercised against a synthetic fixture below) ---

// Extract MCP tool names from server.js source. Supports ', ", and ` string quotes.
function extractToolNames(serverSrc) {
  const re = /server\.tool\(\s*['"`]([^'"`]+)['"`]/g;
  const names = [];
  let m;
  while ((m = re.exec(serverSrc)) !== null) names.push(m[1]);
  return names;
}

// Count raw `server.tool(` call sites (quote-style agnostic) to cross-check that
// extractToolNames didn't miss one because of an unexpected quote style.
function countToolCalls(serverSrc) {
  return (serverSrc.match(/server\.tool\(/g) || []).length;
}

// Slice the README down to just the "MCP Tools Reference" section (heading → next
// `## ` heading) so prose / changelog / comparison-table mentions elsewhere in the
// README can't mask a missing row in the actual tools table.
function mcpTableRegion(readmeSrc) {
  const start = readmeSrc.indexOf('MCP Tools Reference');
  if (start === -1) return '';
  const rest = readmeSrc.slice(start);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// Returns the coverage gaps as a list of { tool, where }.
function coverageGaps(serverSrc, readmeSrc, docsSrc) {
  const names = extractToolNames(serverSrc);
  const region = mcpTableRegion(readmeSrc);
  const gaps = [];
  for (const name of names) {
    if (!region.includes(name)) gaps.push({ tool: name, where: 'README MCP Tools Reference table' });
    if (!docsSrc.includes(name)) gaps.push({ tool: name, where: 'docs/trackly-tools.md' });
  }
  return gaps;
}

// --- real-repo assertions ---

const serverSrc = fs.readFileSync(path.join(ROOT, 'mcp/server.js'), 'utf8');
const readmeSrc = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const docsSrc = fs.readFileSync(path.join(ROOT, 'docs/trackly-tools.md'), 'utf8');

test('tool extraction is not vacuous and matches the raw server.tool( count', () => {
  const names = extractToolNames(serverSrc);
  const rawCount = countToolCalls(serverSrc);
  assert.ok(names.length > 0, 'extracted zero MCP tools — the extraction is broken/vacuous');
  assert.equal(
    names.length,
    rawCount,
    `extracted ${names.length} tool names but found ${rawCount} server.tool( calls — a quote style was missed`
  );
});

test('every MCP tool is documented in the README table AND docs/trackly-tools.md', () => {
  const gaps = coverageGaps(serverSrc, readmeSrc, docsSrc);
  assert.deepEqual(
    gaps,
    [],
    'undocumented MCP tools:\n' + gaps.map((g) => `  - ${g.tool} missing from ${g.where}`).join('\n')
  );
});

test('checker FAILS on an undocumented tool (fixture — proves the gate is not vacuous)', () => {
  // Append a synthetic 12th tool that exists in neither doc. The checker must flag
  // it in BOTH the README table and docs/trackly-tools.md. No repo files are mutated.
  const fakeServer = serverSrc + "\n  server.tool('trackly_fake_undocumented', 'x', {}, async () => ({}));\n";
  const gaps = coverageGaps(fakeServer, readmeSrc, docsSrc);
  const fakeGaps = gaps.filter((g) => g.tool === 'trackly_fake_undocumented');
  assert.equal(
    fakeGaps.length,
    2,
    'fixture: an undocumented tool should be flagged in BOTH the README table and docs/trackly-tools.md'
  );
});

module.exports = { extractToolNames, countToolCalls, mcpTableRegion, coverageGaps };
