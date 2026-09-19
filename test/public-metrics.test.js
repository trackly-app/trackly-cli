const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const currentSurfaces = ['package.json', 'server.json', 'README.md', 'CLAUDE.md', 'AGENTS.md'];
const source = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'public-marketing-metrics-v1.json'), 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'public-metrics.generated.json'), 'utf8'));
const { isFreshForBuild, publicDisplay, render, replaceMetricsCopy } = require('../scripts/sync-public-metrics');

// Dates are derived from the committed snapshot so a routine metrics refresh
// does not require rewriting these tests.
function daysAfterSnapshot(days) {
  const at = new Date(generated.sourceTimestamp);
  at.setDate(at.getDate() + days);
  return at;
}
const freshAt = daysAfterSnapshot(0);
const staleAt = daysAfterSnapshot(generated.maximumAgeInDays + 1);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('current CLI and MCP metadata use the conservative public metrics snapshot', () => {
  assert.deepEqual(generated, render(source));
  assert.equal(generated.sourceEndpoint, '/api/admin/public-marketing-metrics');
  assert.equal(generated.sourceDatabase, 'azure-blue');
  assert.equal(isFreshForBuild(generated, freshAt), true);
  for (const relativePath of currentSurfaces) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /128(?:K|,000)\+ jobs/i, relativePath);
    assert.doesNotMatch(source, /1,900\+ companies/i, relativePath);
    assert.match(source, new RegExp(escapeRegExp(generated.display.jobs)), relativePath);
    // Every numeric metric phrase must be the current snapshot value, so a
    // previous bucket (for example 170K+ or 3,800+) cannot linger.
    for (const match of source.match(/\b\d+K\+ jobs\b/g) ?? []) {
      assert.equal(match, generated.display.jobs, relativePath);
    }
    for (const match of source.match(/\b\d{1,3}(?:,\d{3})*\+ companies\b/g) ?? []) {
      assert.equal(match, generated.display.companies, relativePath);
    }
    assert.match(source, new RegExp(escapeRegExp(generated.display.companies)), relativePath);
  }
});

test('stale or missing metrics use nonnumeric public copy', () => {
  assert.deepEqual(publicDisplay(null), {
    jobs: 'Thousands of jobs',
    companies: 'Thousands of companies',
  });
  assert.deepEqual(publicDisplay(generated, staleAt), {
    jobs: 'Thousands of jobs',
    companies: 'Thousands of companies',
  });
  assert.equal(
    replaceMetricsCopy(
      `Search ${generated.display.jobs} across ${generated.display.companies}.`,
      generated,
      staleAt,
    ),
    'Search Thousands of jobs across Thousands of companies.',
  );
});

test('stale MCP server description stays within the registry 100-character limit', () => {
  const numeric = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')).description;
  assert.ok(numeric.length <= 100, numeric);
  const prepared = replaceMetricsCopy(
    fs.readFileSync(path.join(root, 'server.json'), 'utf8'),
    generated,
    staleAt,
  );
  const description = JSON.parse(prepared).description;
  assert.match(description, /Thousands of jobs/);
  assert.match(description, /Thousands of companies/);
  assert.ok(description.length <= 100, description);
});

test('preparation replaces a previous numeric rounding bucket', () => {
  assert.equal(
    replaceMetricsCopy(
      'Search 160K+ jobs across 3,700+ companies.',
      generated,
      freshAt,
    ),
    `Search ${generated.display.jobs} across ${generated.display.companies}.`,
  );
});
