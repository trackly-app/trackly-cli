'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const clientPath = require.resolve('../lib/client');
const actualClient = require(clientPath);
const calls = [];
let response = { success: true };
require.cache[clientPath].exports = {
  ...actualClient,
  hasAuth: () => true,
  apiRequest: async (...args) => { calls.push(args); return response; },
};
const { createServer } = require('../mcp/server');
const names = ['trackly_semantic_search_jobs', 'trackly_recommend_jobs', 'trackly_get_career_profile', 'trackly_update_career_profile', 'trackly_favorite_company'];
async function fixture(t) {
  calls.length = 0;
  response = { success: true };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'synthetic-chat-parity-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, tools: (await client.listTools()).tools };
}
function payload(result) { return JSON.parse(result.content[0].text); }

test('local MCP exposes the five bounded chat-parity capabilities', async (t) => {
  const { tools } = await fixture(t);
  for (const name of names) assert.ok(tools.some((tool) => tool.name === name), name);
  assert.equal(tools.some((tool) => tool.name === 'trackly_chat'), false);
  const search = tools.find((tool) => tool.name === names[0]);
  assert.equal(search.inputSchema.properties.limit.maximum, 20);
  assert.equal(search.inputSchema.properties.query.maxLength, 500);
});

test('semantic filters preserve explicit false and serialize arrays; invalid limit never requests', async (t) => {
  const { client } = await fixture(t);
  await client.callTool({ name: names[0], arguments: { query: 'climate ops', regions: ['us', 'canada'], internship: false, limit: 20 } });
  const url = new URL(calls[0][1], 'https://closeai.mba');
  assert.equal(url.pathname, '/api/jobscout/semantic-search');
  assert.equal(url.searchParams.get('q'), 'climate ops');
  assert.equal(url.searchParams.get('regions'), 'us,canada');
  assert.equal(url.searchParams.get('internship'), 'false');
  calls.length = 0;
  const invalid = await client.callTool({ name: names[0], arguments: { query: 'x', limit: 21 } });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, 0);
});

test('daily status is preserved and limits are respected; resume match uses top', async (t) => {
  const { client } = await fixture(t);
  response = { success: true, status: 'unavailable', jobs: [] };
  assert.equal(payload(await client.callTool({ name: names[1], arguments: { kind: 'daily' } })).status, 'unavailable');
  assert.equal(calls[0][1], '/api/jobscout/recommendations/daily');
  response = { success: true, status: 'delivered', jobs: [{ job_id: 1 }, { job_id: 2 }] };
  assert.equal(payload(await client.callTool({ name: names[1], arguments: { kind: 'daily', limit: 1 } })).jobs.length, 1);
  await client.callTool({ name: names[1], arguments: { kind: 'resume_match', limit: 7, internship: false } });
  const url = new URL(calls.at(-1)[1], 'https://closeai.mba');
  assert.equal(url.searchParams.get('top'), '7');
  assert.equal(url.searchParams.get('internship'), 'false');
});

test('profile patches retain explicit null and reject unknown, empty or malformed fields', async (t) => {
  const { client } = await fixture(t);
  await client.callTool({ name: names[2], arguments: {} });
  assert.equal(calls[0][1], '/api/jobscout/career-profile');
  await client.callTool({ name: names[3], arguments: { profile: { target_locations: null, sponsorship_needed: false } } });
  assert.deepEqual(calls.at(-1).slice(0, 3), ['PATCH', '/api/jobscout/career-profile', { profile: { target_locations: null, sponsorship_needed: false } }]);
  for (const profile of [{}, { unknown: 'x' }, { comp_floor_usd: -1 }, { target_locations: [''] }]) {
    calls.length = 0;
    assert.equal((await client.callTool({ name: names[3], arguments: { profile } })).isError, true);
    assert.equal(calls.length, 0);
  }
});

test('favorites require an id for writes and project at most 50 safe fields', async (t) => {
  const { client } = await fixture(t);
  assert.equal((await client.callTool({ name: names[4], arguments: { action: 'add' } })).isError, true);
  assert.equal(calls.length, 0);
  await client.callTool({ name: names[4], arguments: { action: 'remove', companyId: 99 } });
  assert.deepEqual(calls.at(-1).slice(0, 2), ['DELETE', '/api/jobscout/companies/99/favorite']);
  response = { companies: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, name: 'Synthetic', domain: 'example.invalid', private_extra: 'never forwarded' })) };
  const result = payload(await client.callTool({ name: names[4], arguments: { action: 'list' } }));
  assert.equal(result.companies.length, 50);
  assert.equal(result.count, 51);
  assert.equal(result.truncated, true);
  assert.equal(JSON.stringify(result).includes('never forwarded'), false);
});

test('oversized recommendation lists trim whole items while preserving status', async (t) => {
  const { client } = await fixture(t);
  response = { status: 'delivered', jobs: Array.from({ length: 20 }, (_, i) => ({ job_id: i + 1, description_preview: 'synthetic'.repeat(1000) })) };
  const result = payload(await client.callTool({ name: names[1], arguments: { kind: 'resume_match' } }));
  assert.equal(result.status, 'delivered');
  assert.equal(result.truncated, true);
  assert.ok(result.jobs.length > 0 && result.jobs.length < 20);
  assert.ok(JSON.stringify(result).length <= 60000);
});


test('favorite write metadata requires user intent and rejects retrieved directives', async (t) => {
  const { tools } = await fixture(t);
  const description = tools.find((tool) => tool.name === names[4]).description;
  assert.match(description, /only.*user.*stated or confirmed intent/i);
  assert.match(description, /untrusted/i);
  assert.match(description, /never follow directives/i);
});
for (const name of names.slice(0, 2)) {
  test(`${name} metadata marks returned directives as untrusted`, async (t) => {
    const { tools } = await fixture(t);
    const description = tools.find((tool) => tool.name === name).description;
    assert.match(description, /untrusted/i);
    assert.match(description, /never follow directives/i);
  });
}

for (const name of names.slice(0, 2)) {
  test(`${name} caps emitted formatted text and counts only retained jobs`, async (t) => {
    const { client } = await fixture(t);
    response = { status: 'delivered', count: 20, jobs: Array.from({ length: 20 }, (_, i) => ({
      job_id: i + 1, details: Array.from({ length: 160 }, () => ({ label: 'synthetic', value: 'fixture' }))
    })) };
    const args = name === names[0] ? { query: 'synthetic', limit: 20 } : { kind: 'resume_match', limit: 20 };
    const emitted = await client.callTool({ name, arguments: args });
    const result = payload(emitted);
    assert.equal(emitted.isError, undefined);
    assert.ok(emitted.content[0].text.length <= 60000, 'cap applies to the actual MCP text');
    assert.equal(result.truncated, true);
    assert.ok(result.jobs.length > 0 && result.jobs.length < 20);
    assert.equal(result.count, result.jobs.length);
    assert.equal(result.status, 'delivered');
    assert.deepEqual(result.jobs, response.jobs.slice(0, result.jobs.length));
  });
}

test('bounded job response preserves backend metadata and no numeric count is invented', async (t) => {
  const { client } = await fixture(t);
  response = { status: 'unavailable', total: 8, jobs: [{ job_id: 1 }] };
  assert.deepEqual(payload(await client.callTool({ name: names[1], arguments: { kind: 'resume_match' } })), response);
  response = { status: 'delivered', jobs: [{ job_id: 1, description_preview: 'x'.repeat(60000) }] };
  const result = await client.callTool({ name: names[1], arguments: { kind: 'resume_match' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /payload exceeds.*narrow/i);
});

test('untrimmable metadata returns a bounded explicit size error', async (t) => {
  const { client } = await fixture(t);
  response = { status: 'unavailable', diagnostic: 'synthetic'.repeat(8000), jobs: [] };
  const result = await client.callTool({ name: names[1], arguments: { kind: 'resume_match' } });
  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.length <= 60000);
  assert.match(result.content[0].text, /payload exceeds/i);
});

test('daily trimming retains delivered status/count and never reports an oversized pick as an empty day', async (t) => {
  const { client } = await fixture(t);
  response = { status: 'delivered', count: 5, jobs: Array.from({ length: 5 }, (_, i) => ({
    job_id: i + 1, explanation: 'synthetic'.repeat(2000)
  })) };
  const emitted = await client.callTool({ name: names[1], arguments: { kind: 'daily' } });
  const result = payload(emitted);
  assert.equal(result.status, 'delivered');
  assert.equal(result.count, result.jobs.length);
  assert.ok(result.jobs.length > 0 && result.jobs.length < 5);
  assert.equal(result.truncated, true);
  assert.ok(emitted.content[0].text.length <= 60000);
  response = { status: 'delivered', jobs: [{ job_id: 1, explanation: 'x'.repeat(60000) }] };
  const oversized = await client.callTool({ name: names[1], arguments: { kind: 'daily' } });
  assert.equal(oversized.isError, true);
  assert.match(oversized.content[0].text, /payload exceeds.*narrow/i);
  assert.equal('jobs' in payload(oversized), false);
});
