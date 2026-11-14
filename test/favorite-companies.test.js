'use strict';

// "Favorite a list" npm MCP tools (close-ai #3867). They mirror close-ai
// src/mcp/favorite-companies-tool.ts: same names, schemas and request body, and the
// same REST endpoints, so matching, quotas and the 100-company cap stay server-side.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const {
  FAVORITE_COMPANIES_MAX,
  FAVORITE_COMPANIES_DESCRIPTION,
  UNFAVORITE_COMPANIES_DESCRIPTION,
  favoriteCompaniesInputShape,
  unfavoriteCompaniesInputShape,
  favoriteCompaniesRequestBody,
} = require('../mcp/favorite-companies');
const { toolTitle } = require('../mcp/tool-families');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');

test('the request body sends ids, names and requestNames as favorite-when-added requests, tagged mcp', () => {
  assert.deepEqual(favoriteCompaniesRequestBody({ companyIds: [1], names: ['Stripe'], requestNames: ['Square'] }), {
    companyIds: [1],
    names: ['Stripe'],
    requests: [{ query: 'Square', favoriteWhenAdded: true }],
    source: 'mcp',
  });
  assert.deepEqual(favoriteCompaniesRequestBody({ companyIds: [], names: ['A'] }), { names: ['A'], source: 'mcp' });
});

test('more than 100 entries in total fails before any API call', () => {
  const ids = Array.from({ length: 60 }, (_, i) => i + 1);
  const names = Array.from({ length: 41 }, (_, i) => `Co ${i}`);
  assert.throws(() => favoriteCompaniesRequestBody({ companyIds: ids, names }), /At most 100 companies per call in total/);
  assert.doesNotThrow(() => favoriteCompaniesRequestBody({ companyIds: ids, names: names.slice(0, 40) }));
  assert.equal(FAVORITE_COMPANIES_MAX, 100);
});

test('input schemas cap each list at 100 and require at least one id to unfavorite', () => {
  const favorite = z.object(favoriteCompaniesInputShape);
  const unfavorite = z.object(unfavoriteCompaniesInputShape);
  assert.equal(favorite.safeParse({ companyIds: Array.from({ length: 101 }, (_, i) => i + 1) }).success, false);
  assert.equal(favorite.safeParse({ names: ['Stripe'], requestNames: ['Square'] }).success, true);
  assert.equal(unfavorite.safeParse({ companyIds: [] }).success, false);
  assert.equal(unfavorite.safeParse({ companyIds: [1, 2] }).success, true);
});

test('both tools are registered against the bulk favorites endpoints with the shared descriptions', () => {
  assert.match(SERVER_SRC, /server\.tool\('trackly_favorite_companies', FAVORITE_COMPANIES_DESCRIPTION, favoriteCompaniesInputShape/);
  assert.match(SERVER_SRC, /apiRequest\('POST', '\/api\/jobscout\/companies\/favorites\/bulk',\s*favoriteCompaniesRequestBody\(args\)/);
  assert.match(SERVER_SRC, /server\.tool\('trackly_unfavorite_companies', UNFAVORITE_COMPANIES_DESCRIPTION, unfavoriteCompaniesInputShape/);
  assert.match(SERVER_SRC, /apiRequest\('POST', '\/api\/jobscout\/companies\/favorites\/bulk-remove',\s*\{ companyIds \}/);
  assert.match(FAVORITE_COMPANIES_DESCRIPTION, /^Favorite a list of companies in one call: up to 100 in total/);
  assert.match(FAVORITE_COMPANIES_DESCRIPTION, /unidentified_url/);
  assert.match(UNFAVORITE_COMPANIES_DESCRIPTION, /^Remove up to 100 companies from the user's favorites by company ID/);
});

test('the tools carry the Companies family titles shared with the hosted server', () => {
  assert.equal(toolTitle('trackly_favorite_companies'), 'Companies · Favorite a list');
  assert.equal(toolTitle('trackly_unfavorite_companies'), 'Companies · Unfavorite');
});
