'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { createTempConfigDir, startMockServer, withEnv } = require('./helpers');

test('auto-apply uses the strict public MCP shape and server-owned results', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  let fixture = { status: 201, body: { request: { id: 'request-1', jobId: 42, status: 'queued' } } };
  const requests = [];
  const { server: httpServer, port } = await startMockServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body, userAgent: req.headers['user-agent'] });
      res.writeHead(fixture.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixture.body));
    });
  });
  t.after(() => new Promise(resolve => httpServer.close(resolve)));
  await withEnv({ TRACKLY_API_KEY: 'trk_test_fixture', TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}` }, async () => {
    const server = createServer();
    const client = new Client({ name: 'paid-plans-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find(value => value.name === 'trackly_auto_apply');
      assert.ok(tool);
      assert.deepEqual(Object.keys(tool.inputSchema.properties), ['jobId']);
      assert.deepEqual(tool.inputSchema.required, ['jobId']);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.doesNotMatch(tool.description, /upgrade|\$|price|subscribe|purchase/i);

      let result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      assert.equal(result.isError, undefined);
      let payload = JSON.parse(result.content[0].text);
      assert.deepEqual(payload.request, fixture.body.request);
      assert.match(payload.message, /Trackly will apply and notify you/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, '/api/jobscout/apply/assist-requests');
      assert.equal(requests[0].method, 'POST');
      assert.match(requests[0].userAgent, /^trackly-mcp\//);
      assert.deepEqual(JSON.parse(requests[0].body), { jobId: 42, acknowledged: true });

      for (const args of [{}, { jobId: 0 }, { jobId: -1 }, { jobId: 1.5 }, { jobId: '42' },
        { jobId: 2147483648 }, { jobId: 42, resumeId: 21 }, { jobId: 42, acknowledged: false }]) {
        const before = requests.length;
        result = await client.callTool({ name: 'trackly_auto_apply', arguments: args });
        assert.equal(result.isError, true);
        assert.equal(requests.length, before, 'invalid shape must not reach the API');
      }

      for (const [status, body, expected] of [
        [404, { error: 'feature_disabled' }, /Auto-apply is not available for this account yet/],
        [404, { error: 'Not found' }, /Auto-apply is not available for this account yet/],
        [429, { error: 'limit_reached', feature: 'assist_request', used: 15, limit: 15,
          resetsAt: null, upgradeUrl: null }, /cloud auto-apply.*Used 15 of 15/],
        [429, { error: 'assist_limit_reached', feature: 'assist_request', used: 100, limit: 100,
          resetsAt: '2026-12-01T00:00:00Z', upgradeUrl: 'https://example.com/from-server' }, /Used 100 of 100.*Resets on.*https:\/\/example.com\/from-server/],
        [429, { error: 'slow_down' }, /Rate limited, try again shortly/],
        [400, { error: 'invalid_assist_request' }, /invalid_assist_request/],
        [500, { error: 'unavailable' }, /unavailable/],
        [401, { error: 'Not authenticated' }, /Not authenticated/],
      ]) {
        fixture = { status, body };
        const before = requests.length;
        result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
        assert.equal(result.isError, true);
        payload = JSON.parse(result.content[0].text);
        assert.match(payload.message || payload.error, expected);
        assert.equal(payload.status, status);
        assert.equal(requests.length, before + 1, 'mutation refusal must not retry');
        assert.doesNotMatch(JSON.stringify(payload), /20 natural|daily limit/i);
        if (status === 404 || body.error.endsWith('limit_reached')) assert.equal(payload.retryable, false);
        if (body.error.endsWith('limit_reached')) {
          for (const key of ['feature', 'used', 'limit', 'resetsAt', 'upgradeUrl']) assert.deepEqual(payload[key], body[key]);
        }
      }

      for (const flag of [true, false, undefined]) {
        const job = { id: 42, title: 'PM', ...(flag === undefined ? {} : { autoApplySupported: flag }) };
        fixture = { status: 200, body: { jobs: [job] } };
        result = await client.callTool({ name: 'trackly_search_jobs', arguments: {} });
        assert.deepEqual(JSON.parse(result.content[0].text).jobs, [job]);
      }

      fixture = { status: 429, body: { error: 'limit_reached', feature: 'agent_fill', used: 0, limit: 0, resetsAt: null } };
      for (const [name, args] of [['trackly_ask', { query: 'PM' }], ['trackly_get_job', { id: 42 }]]) {
        result = await client.callTool({ name, arguments: args });
        payload = JSON.parse(result.content[0].text);
        assert.equal(payload.retryable, false);
        assert.match(payload.message, /agent fills.*Used 0 of 0/);
        assert.equal(Object.hasOwn(payload, 'upgradeUrl'), false);
        assert.doesNotMatch(JSON.stringify(payload), /https:|20 natural/);
        if (name === 'trackly_get_job') {
          assert.equal(payload.category, 'rate_limit');
          assert.equal(payload.maxRetries, 0);
          assert.equal(Object.hasOwn(payload, 'retryAfterSeconds'), false);
        }
      }
      await withEnv({ TRACKLY_API_KEY: undefined }, async () => {
        const before = requests.length;
        result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
        assert.equal(result.isError, true);
        assert.equal(JSON.parse(result.content[0].text).status, 401);
        assert.equal(requests.length, before);
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
