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
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { createTempConfigDir, startMockServer, withEnv } = require('./helpers');

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

test('both tools call the bulk endpoints end to end, authenticated, and pass the per-item report through', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const requests = [];
  const report = { success: true, favorited: [{ companyId: 1, name: 'Stripe' }], alreadyFavorite: [], needsChoice: [],
    requested: [{ query: 'Square', requestId: 7, reused: false, favoriteWhenAdded: true, input: 'Square' }],
    favoriteWhenAdded: [{ query: 'Square', requestId: 7 }], failed: [] };
  const { server: httpServer, port } = await startMockServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || req.headers['x-api-key'] || '' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url.endsWith('/bulk-remove')
        ? { success: true, unfavorited: [{ companyId: 1, name: 'Stripe' }], notFavorite: [], failed: [] }
        : report));
    });
  });
  t.after(() => new Promise((resolve) => httpServer.close(resolve)));
  await withEnv({ TRACKLY_API_KEY: 'trk_test_fixture', TRACKLY_CONFIG_DIR: configDir, TRACKLY_BASE_URL: `http://127.0.0.1:${port}` }, async () => {
    const server = createServer();
    const client = new Client({ name: 'favorite-companies-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const favorite = await client.callTool({ name: 'trackly_favorite_companies', arguments: { companyIds: [1], requestNames: ['Square'] } });
      assert.equal(favorite.isError, undefined);
      assert.deepEqual(JSON.parse(favorite.content[0].text), report);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/api/jobscout/companies/favorites/bulk');
      assert.deepEqual(JSON.parse(requests[0].body), { companyIds: [1], requests: [{ query: 'Square', favoriteWhenAdded: true }], source: 'mcp' });
      assert.ok(requests[0].auth.length > 0, 'the call must carry the user credential');

      const unfavorite = await client.callTool({ name: 'trackly_unfavorite_companies', arguments: { companyIds: [1] } });
      assert.equal(unfavorite.isError, undefined);
      assert.equal(requests[1].url, '/api/jobscout/companies/favorites/bulk-remove');
      assert.deepEqual(JSON.parse(requests[1].body), { companyIds: [1] });

      const over = await client.callTool({ name: 'trackly_favorite_companies', arguments: {
        companyIds: Array.from({ length: 60 }, (_, i) => i + 1), names: Array.from({ length: 41 }, (_, i) => `Co ${i}`) } });
      assert.equal(over.isError, true);
      assert.equal(requests.length, 2, 'an over-cap call makes no API request');
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
});
