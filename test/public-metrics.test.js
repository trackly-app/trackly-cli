const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const currentSurfaces = ['package.json', 'server.json', 'README.md', 'CLAUDE.md', 'AGENTS.md'];
const source = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'public-marketing-metrics-v1.json'), 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'public-metrics.generated.json'), 'utf8'));
const { isFreshForBuild, publicDisplay, render, replaceMetricsCopy } = require('../scripts/sync-public-metrics');

test('current CLI and MCP metadata use the conservative public metrics snapshot', () => {
  assert.deepEqual(generated, render(source));
  assert.equal(generated.sourceEndpoint, '/api/admin/public-marketing-metrics');
  assert.equal(generated.sourceDatabase, 'azure-blue');
  assert.equal(isFreshForBuild(generated, new Date('2026-08-04T00:00:00-07:00')), true);
  for (const relativePath of currentSurfaces) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /128(?:K|,000)\+ jobs/i, relativePath);
    assert.doesNotMatch(source, /1,900\+ companies/i, relativePath);
    assert.match(source, /170(?:K|,000)\+ jobs/i, relativePath);
    assert.match(source, /3,800\+ companies/i, relativePath);
  }
});

test('stale or missing metrics use nonnumeric public copy', () => {
  assert.deepEqual(publicDisplay(null), {
    jobs: 'Thousands of jobs',
    companies: 'Thousands of companies',
  });
  assert.deepEqual(publicDisplay(generated, new Date('2026-10-01T00:00:00-07:00')), {
    jobs: 'Thousands of jobs',
    companies: 'Thousands of companies',
  });
  assert.equal(
    replaceMetricsCopy(
      'Search 170K+ jobs across 3,800+ companies.',
      generated,
      new Date('2026-10-01T00:00:00-07:00'),
    ),
    'Search Thousands of jobs across Thousands of companies.',
  );
});

test('stale MCP server description stays within the registry 100-character limit', () => {
  const numeric = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8')).description;
  assert.match(numeric, /^AI job search:/);
  assert.ok(numeric.length <= 100, numeric);
  const prepared = replaceMetricsCopy(
    fs.readFileSync(path.join(root, 'server.json'), 'utf8'),
    generated,
    new Date('2026-10-01T00:00:00-07:00'),
  );
  const description = JSON.parse(prepared).description;
  assert.match(description, /^AI job search:/);
  assert.match(description, /Thousands of jobs/);
  assert.match(description, /Thousands of companies/);
  assert.ok(description.length <= 100, description);
  // Exact 422 body.description from publish run 35030261087 after 0.18.3.
  const rejected = 'AI job search for Claude, ChatGPT, Cursor. Thousands of jobs, Thousands of companies. OAuth or stdio.';
  assert.equal(rejected.length, 101);
  assert.notEqual(description, rejected);
});

test('preparation replaces a previous numeric rounding bucket', () => {
  assert.equal(
    replaceMetricsCopy(
      'Search 160K+ jobs across 3,700+ companies.',
      generated,
      new Date('2026-08-04T01:00:00-07:00'),
    ),
    'Search 170K+ jobs across 3,800+ companies.',
  );
});
