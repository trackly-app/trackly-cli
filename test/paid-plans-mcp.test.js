'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { AUTO_APPLY_DESCRIPTION, AUTO_APPLY_SEARCH_FIELD_DESCRIPTION } = require('../lib/auto-apply');
const { createTempConfigDir, startMockServer, withEnv } = require('./helpers');

test('the published MCP catalog lists both Trackly Apply (cloud) tools and keeps the hosted update_status text', async () => {
  const server = createServer();
  const client = new Client({ name: 'held-auto-apply-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    assert.equal(byName.trackly_update_status.description,
      'Update a job application status (apply, save, or dismiss).');
    // The description names Trackly Apply (local) and Trackly Apply (cloud) side by side.
    const description = byName.trackly_auto_apply.description;
    assert.equal(description, AUTO_APPLY_DESCRIPTION);
    assert.match(description, /^Requests Trackly Apply \(cloud\) for one Trackly job: Trackly applies to the employer for the user/);
    assert.match(description, /every saved application profile answer, sensitive ones included/);
    assert.match(description, /Nothing runs on the user's computer/);
    assert.match(description, /Trackly Apply \(local\), where the user's own AI agent fills the application in the user's browser and stops before Submit/);
    assert.match(description, /trackly_update_status with action=applied, which only records an application the user made themselves/);
    assert.match(description, /trackly_auto_apply_status reports progress later/);
    assert.doesNotMatch(description, /upgrade|\$|price|subscribe|purchase/i);
    assert.match(byName.trackly_auto_apply_status.description, /^Lists the user's Trackly Apply \(cloud\) requests/);
    assert.ok(byName.trackly_search_jobs.description.endsWith(` ${AUTO_APPLY_SEARCH_FIELD_DESCRIPTION}`));
    assert.ok(!tools.some(tool => /cloud auto-apply/i.test(tool.description)));
    assert.deepEqual(byName.trackly_auto_apply_status.annotations,
      { title: 'Get Trackly Apply (cloud) requests', readOnlyHint: true, openWorldHint: false });
    assert.deepEqual(Object.keys(byName.trackly_auto_apply_status.inputSchema.properties), ['jobIds']);
    assert.equal(byName.trackly_auto_apply_status.inputSchema.required, undefined);
    assert.equal(byName.trackly_auto_apply_status.inputSchema.additionalProperties, false);
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

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
      if (fixture.disconnect) return req.socket.destroy();
      res.writeHead(fixture.status, { 'Content-Type': fixture.raw ? 'text/html' : 'application/json' });
      res.end(fixture.raw || JSON.stringify(fixture.body));
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
      assert.deepEqual(tool.annotations, { title: 'Trackly Apply (cloud): apply to a job',
        readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
      assert.deepEqual(Object.keys(tool.inputSchema.properties), ['jobId']);
      assert.deepEqual(tool.inputSchema.required, ['jobId']);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.doesNotMatch(tool.description, /upgrade|\$|price|subscribe|purchase/i);

      let result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      assert.equal(result.isError, undefined);
      let payload = JSON.parse(result.content[0].text);
      // The hosted projection: the request identity, company and title, and status.
      assert.deepEqual(payload, {
        request: { id: 'request-1', jobId: 42, company: null, jobTitle: null, status: 'queued' },
        message: 'Trackly will submit this application and notify you when it is done. trackly_auto_apply_status or the Trackly web app shows its status.',
      });
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
        [404, { error: 'feature_disabled' }, /Trackly Apply \(cloud\) is not available for this account yet/],
        [404, { error: 'job_not_found' }, /Job not found.*Check the Trackly job ID/],
        [404, { error: 'Not found' }, /Trackly Apply \(cloud\) is not available for this account yet/],
        [429, { error: 'limit_reached', feature: 'assist_request', used: 15, limit: 15,
          resetsAt: null, upgradeUrl: null }, /Trackly Apply \(cloud\).*Used 15 of 15/],
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
        if (body.error === 'slow_down') assert.equal(payload.retryable, undefined);
        if (body.error === 'Not found') assert.equal(payload.diagnostic, 'Not found');
        assert.equal(requests.length, before + 1, 'mutation refusal must not retry');
        assert.doesNotMatch(JSON.stringify(payload), /20 natural|daily limit/i);
        if (status === 404 || status >= 500 || body.error.endsWith('limit_reached')) assert.equal(payload.retryable, false);
        if (status >= 500) assert.match(payload.error, /Check whether the request exists with trackly_auto_apply_status before requesting again/);
        if (body.error.endsWith('limit_reached')) {
          for (const key of ['feature', 'used', 'limit', 'resetsAt', 'upgradeUrl']) assert.deepEqual(payload[key], body[key]);
        }
      }

      for (const code of ['maintenance_mode', 'ACCESS_CHECK_UNAVAILABLE']) {
        fixture = { status: 503, body: { code, message: 'Temporarily unavailable' } };
        result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
        payload = JSON.parse(result.content[0].text);
        assert.equal(result.isError, true);
        assert.equal(payload.code, code);
      }

      fixture = { status: 429, body: { error: 'limit_reached', feature: 'constructor',
        used: 'untrusted-text', limit: -1, resetsAt: {}, upgradeUrl: 'javascript:alert(1)' } };
      result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      for (const key of ['feature', 'used', 'limit', 'resetsAt', 'upgradeUrl']) assert.equal(Object.hasOwn(payload, key), false);
      assert.doesNotMatch(JSON.stringify(payload), /untrusted-text|javascript|constructor/);

      fixture = { disconnect: true };
      const beforeDisconnect = requests.length;
      result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      assert.equal(payload.retryable, false);
      assert.equal(payload.code, 'auto_apply_status_unknown');
      assert.match(payload.error, /Check whether the request exists with trackly_auto_apply_status/);
      assert.equal(requests.length, beforeDisconnect + 1);

      fixture = { status: 404, raw: '<html>private-proxy-body</html>' };
      result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      assert.match(payload.message, /Trackly Apply \(cloud\) is not available for this account yet/);
      assert.match(payload.diagnostic, /non-JSON response/);
      assert.doesNotMatch(JSON.stringify(payload), /private-proxy-body/);

      fixture = { status: 404, body: { error: 'Not found\u001b[31m\u0007\r\n\u007f' } };
      result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      assert.equal(payload.diagnostic, 'Not found[31m');
      assert.doesNotMatch(payload.message + payload.diagnostic, /[\u0000-\u001f\u007f]/);

      fixture = { status: 500, body: { error: '\u001b\u0007\r\n\u007f\u009b' + 'x'.repeat(900) } };
      const beforeUncertain = requests.length;
      result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
      payload = JSON.parse(result.content[0].text);
      assert.equal(result.isError, true);
      assert.equal(payload.retryable, false);
      assert.equal(requests.length, beforeUncertain + 1);
      assert.doesNotMatch(payload.message, /[\u0000-\u001f\u007f-\u009f]|x{501}/);
      assert.match(payload.message, /x{500}\. Check whether the request exists with trackly_auto_apply_status/);

      // The REST constant false is replaced by the Trackly Apply (cloud) answer, as on the hosted MCP.
      const supported = { id: 1, isUs: true, isActive: true, jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/1', autoApplySupported: false };
      const searchJobs = [
        supported,
        { id: 2, isUs: true, jobUrl: 'https://jobs.lever.co/acme/2', userStatus: 'applied_confirmed' },
        { id: 3, isUs: true, jobUrl: 'https://jobs.ashbyhq.com/acme/3' },
        { id: 4, isUs: false, jobUrl: 'https://jobs.lever.co/acme/4' },
        { id: 5, jobUrl: 'https://jobs.lever.co/acme/5' },
        { id: 6, isUs: true, isActive: false, jobUrl: 'https://jobs.lever.co/acme/6' },
        { id: 7, isUs: true, jobUrl: 'http://jobs.lever.co/acme/7' },
        { id: 8, isUs: true, jobUrl: 'https://careers.example.com/8', autoApplySupported: true },
        { id: 9, isUs: true, jobUrl: 'not a url' },
      ];
      fixture = { status: 200, body: { jobs: searchJobs, total: 9, nextSteps: 'stale' } };
      result = await client.callTool({ name: 'trackly_search_jobs', arguments: {} });
      payload = JSON.parse(result.content[0].text);
      assert.deepEqual(payload.jobs.map(job => [job.id, job.autoApplySupported]),
        [[1, true], [2, true], [3, true], [4, false], [5, false], [6, false], [7, false], [8, false], [9, false]]);
      assert.equal(payload.nextSteps, 'Trackly Apply (cloud) can apply to up to 2 of these jobs for you.');
      assert.equal(payload.total, 9);
      assert.equal(supported.autoApplySupported, false, 'the backend payload is not mutated');
      fixture = { status: 200, body: { jobs: [{ id: 4, isUs: false, jobUrl: 'https://jobs.lever.co/acme/4' }] } };
      result = await client.callTool({ name: 'trackly_search_jobs', arguments: {} });
      payload = JSON.parse(result.content[0].text);
      assert.equal(Object.hasOwn(payload, 'nextSteps'), false);

      for (const body of [{}, { request: null }, { request: { id: 'x', jobId: 41, status: 'queued' } },
        { request: { id: 'x', jobId: 42 } }, '<html>unexpected-response</html>']) {
        fixture = typeof body === 'string' ? { status: 201, raw: body } : { status: 201, body };
        const before = requests.length;
        result = await client.callTool({ name: 'trackly_auto_apply', arguments: { jobId: 42 } });
        payload = JSON.parse(result.content[0].text);
        assert.equal(result.isError, true);
        assert.equal(payload.code, 'invalid_auto_apply_response');
        assert.equal(payload.retryable, false);
        assert.match(payload.error, /Invalid Trackly Apply \(cloud\) response.*trackly_auto_apply_status/);
        assert.equal(requests.length, before + 1);
      }

      fixture = { status: 429, body: { error: 'slow_down' } };
      for (const [name, args] of [['trackly_update_status', { id: 42, action: 'applied' }],
        ['trackly_start_apply_run', { jobId: 42 }]]) {
        const before = requests.length;
        result = await client.callTool({ name, arguments: args });
        payload = JSON.parse(result.content[0].text);
        assert.equal(result.isError, true);
        assert.equal(payload.retryable, undefined);
        assert.match(payload.message, /Rate limited, try again shortly/);
        assert.equal(requests.length, before + 1);
      }

      fixture = { status: 429, body: { error: 'limit_reached', feature: 'agent_fill', used: 0, limit: 0, resetsAt: null } };
      for (const [name, args] of [['trackly_ask', { query: 'PM' }], ['trackly_get_job', { id: 42 }], ['trackly_get_job_brief', { jobId: 42 }]]) {
        result = await client.callTool({ name, arguments: args });
        payload = JSON.parse(result.content[0].text);
        assert.equal(payload.retryable, false);
        assert.match(payload.message, /agent fills.*Used 0 of 0/);
        assert.equal(Object.hasOwn(payload, 'upgradeUrl'), false);
        assert.doesNotMatch(JSON.stringify(payload), /https:|20 natural/);
        if (name !== 'trackly_ask') {
          assert.equal(payload.category, 'access');
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

test('trackly_auto_apply_status lists bounded request views without enqueueing', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  let fixture = { status: 200, body: { requests: [] } };
  const requests = [];
  const { server: httpServer, port } = await startMockServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      res.writeHead(fixture.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixture.body));
    });
  });
  t.after(() => new Promise(resolve => httpServer.close(resolve)));
  await withEnv({ TRACKLY_API_KEY: 'trk_test_fixture', TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}` }, async () => {
    const server = createServer();
    const client = new Client({ name: 'auto-apply-status-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const row = (index) => ({ id: `request-${index}`, jobId: index, status: 'queued', company: 'Acme',
        jobTitle: 'PM', applicantMessage: null, createdAt: '2026-11-10T20:00:00-08:00', internal: 'dropped' });
      fixture = { status: 200, body: { requests: [row(1), { id: '', jobId: 2, status: 'queued' }, row(3)] } };
      let result = await client.callTool({ name: 'trackly_auto_apply_status', arguments: {} });
      assert.equal(result.isError, undefined);
      let payload = JSON.parse(result.content[0].text);
      assert.equal(requests.at(-1).method, 'GET');
      assert.equal(requests.at(-1).url, '/api/jobscout/apply/assist-requests');
      assert.deepEqual(payload.requests.map(request => request.id), ['request-1', 'request-3']);
      assert.deepEqual(payload.requests[0], { id: 'request-1', jobId: 1, company: 'Acme', jobTitle: 'PM', status: 'queued',
        failureCode: null, applicantMessage: null, createdAt: '2026-11-10T20:00:00-08:00', updatedAt: null, completedAt: null });
      assert.equal(payload.hasMore, false);

      result = await client.callTool({ name: 'trackly_auto_apply_status', arguments: { jobIds: [42, 7, 42] } });
      assert.equal(result.isError, undefined);
      assert.equal(requests.at(-1).url, '/api/jobscout/apply/assist-requests?jobIds=42,7');

      fixture = { status: 200, body: { requests: Array.from({ length: 51 }, (_, index) => row(index + 1)) } };
      payload = JSON.parse((await client.callTool({ name: 'trackly_auto_apply_status', arguments: {} })).content[0].text);
      assert.equal(payload.requests.length, 50);
      assert.equal(payload.hasMore, true);

      for (const args of [{ jobIds: [] }, { jobIds: [0] }, { jobIds: ['42'] }, { jobIds: Array(201).fill(1) }, { status: true }]) {
        const before = requests.length;
        result = await client.callTool({ name: 'trackly_auto_apply_status', arguments: args });
        assert.equal(result.isError, true);
        assert.equal(requests.length, before, 'invalid shape must not reach the API');
      }

      fixture = { status: 200, body: { requests: null } };
      result = await client.callTool({ name: 'trackly_auto_apply_status', arguments: {} });
      assert.equal(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).code, 'invalid_auto_apply_response');

      fixture = { status: 404, body: { error: 'feature_disabled' } };
      result = await client.callTool({ name: 'trackly_auto_apply_status', arguments: {} });
      assert.equal(result.isError, true);
      assert.match(JSON.parse(result.content[0].text).message, /Trackly Apply \(cloud\) is not available for this account yet/);
      assert.ok(requests.every(request => request.method === 'GET'), 'the status tool never enqueues');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
