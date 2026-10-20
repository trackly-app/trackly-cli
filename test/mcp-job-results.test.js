'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { configureMcpAnalytics, shutdownMcpAnalytics } = require('../mcp/analytics');
const { saveConfig } = require('../lib/client');

test('job lookups distinguish unavailable postings from failures through the real SDK and HTTP client', async (t) => {
  const previous = Object.fromEntries(['TRACKLY_BASE_URL', 'TRACKLY_API_KEY', 'TRACKLY_CONFIG_DIR', 'TRACKLY_HTTP_TIMEOUT_MS']
    .map((key) => [key, process.env[key]]));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-job-result-'));
  let fixture;
  const requests = [];
  const events = [];
  const httpServer = http.createServer((request, response) => {
    requests.push(request.url);
    if (fixture.refresh) {
      if (request.url === '/api/auth/refresh') {
        response.writeHead(fixture.refresh === 'success' ? 200 : 401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixture.refresh === 'success'
          ? { success: true, token: 'fixture_new', refreshToken: 'fixture_refresh_new' }
          : { error: 'private-refresh-expired' }));
        return;
      }
      if (request.headers.authorization === 'Bearer fixture_old') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'private-token-expired' }));
        return;
      }
    }
    if (fixture.status === 0) return request.socket.destroy();
    if (fixture.status === -1) return;
    response.writeHead(fixture.status, { 'Content-Type': 'application/json', ...fixture.headers });
    response.end(JSON.stringify(fixture.body));
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  process.env.TRACKLY_BASE_URL = `http://127.0.0.1:${httpServer.address().port}`;
  process.env.TRACKLY_API_KEY = 'trk_job_fixture';
  process.env.TRACKLY_CONFIG_DIR = configDir;
  process.env.TRACKLY_HTTP_TIMEOUT_MS = '100';
  const server = createServer();
  configureMcpAnalytics(server, {
    createRelay: () => ({ capture: (event) => events.push(event), async _shutdown() {} }),
  });
  const client = new Client({ name: 'Codex', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
    await shutdownMcpAnalytics(server);
    await new Promise((resolve) => httpServer.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(configDir, { recursive: true, force: true });
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  for (const [name, field, success] of [
    ['trackly_get_job', 'id', { success: true, job: { id: 42, isActive: true } }],
    ['trackly_get_job_brief', 'jobId', { success: true, brief: { jobId: 42, isActive: true } }],
  ]) {
    await t.test(name, async () => {
      for (const [label, status, body, expectedError, category, retryable, reason, headers] of [
        ['missing job', 404, { success: false, error: 'Job not found' }, false, undefined, false, 'not_found'],
        ['available', 200, success, false],
        ['unknown availability', 200, { success: true, job: { id: 42, isActive: null } }, false],
        ['unknown despite legacy false', 200, { success: true, job: { id: 42, isActive: null, active: false } }, false],
        ['active despite legacy false', 200, { success: true, job: { id: 42, isActive: true, active: false } }, false],
        ['missing brief job', 404, { success: false, error: 'Job 42 not found' }, false, undefined, false, 'not_found'],
        ['removed job', 410, { code: 'job_removed', error: 'Gone' }, false, undefined, false, 'removed'],
        ['closed job', 200, { success: true, job: { id: 42, isActive: false } }, false, undefined, false, 'closed'],
        ['closed stored detail', 200, { success: true, job: { id: 42, active: false } }, false, undefined, false, 'closed'],
        ['closed brief', 200, { success: true, brief: { jobId: 42, isActive: false, companyName: 'Example', companySignal: { openRoleCount: 7 }, actions: [{ type: 'apply' }], recommendedMotion: 'ask_referral', nextActions: [{ type: 'open_job_posting' }] } }, false, undefined, false, 'closed'],
        ...[true, undefined, 'false'].map(success => ['noncanonical missing', 404, { success, error: 'Job not found' }, true, 'not_found', false]),
        ['mismatched missing ID', 404, { success: false, error: 'Job 43 not found' }, true, 'not_found', false],
        ['route missing', 404, { error: 'Cannot GET /private-route' }, true, 'not_found', false],
        ['unrecognized gone', 410, { error: 'unrelated resource gone' }, true, 'not_found', false],
        ['unrecognized code', 404, { code: 'constructor', error: 'Missing route' }, true, 'not_found', false],
        ['expired auth', 401, { error: 'private-token-error' }, true, 'authentication', false],
        ['forbidden', 403, { error: 'private-denial' }, true, 'authorization', false],
        ['invite required', 403, { code: 'INVITATION_REQUIRED', error: 'Invitation required' }, true, 'access', false],
        ['longer access delay', 503, { code: 'ACCESS_CHECK_UNAVAILABLE', retryAfterSeconds: 600 }, true, 'access', true],
        ['header rate delay', 429, { error: 'private-limit' }, true, 'rate_limit', true, undefined, { 'Retry-After': '600' }],
        ['header server delay', 503, { error: 'private-server' }, true, 'server', true, undefined, { 'Retry-After': '900' }],
        ['header access delay', 503, { code: 'ACCESS_CHECK_UNAVAILABLE', retryAfterSeconds: 600 }, true, 'access', true, undefined, { 'Retry-After': '900' }],
        ['body delay wins', 429, { retryAfterSeconds: 900 }, true, 'rate_limit', true, undefined, { 'Retry-After': '600' }],
        ['date header delay', 429, {}, true, 'rate_limit', true, undefined, { 'Retry-After': new Date(Date.now() + 3600000).toUTCString() }],
        ...['invalid', '-1', '1.5', '0', '9007199254740992', '123garbage'].map(value => ['invalid header delay', 429, {}, true, 'rate_limit', true, undefined, { 'Retry-After': value }]),
        ['access unavailable', 503, { code: 'ACCESS_CHECK_UNAVAILABLE', error: 'private-access' }, true, 'access', true],
        ['invalid backend ID', 400, { error: 'Invalid job ID' }, true, 'validation', false],
        ['rate limited', 429, { error: 'private-limit' }, true, 'rate_limit', true],
        ['longer rate limit', 429, { error: 'private-limit', retryAfterSeconds: 600 }, true, 'rate_limit', true],
        ['longer server delay', 500, { error: 'private-server', retryAfterSeconds: 90 }, true, 'server', true],
        ...[30, 0, -1, '120', 120.5, Number.MAX_SAFE_INTEGER + 1].map(retryAfterSeconds => ['default rate delay', 429, { error: 'private-limit', retryAfterSeconds }, true, 'rate_limit', true]),
        ['timeout', 408, { error: 'private-timeout' }, true, 'timeout', true],
        ['server failure', 500, { error: 'private-network-brief-error' }, true, 'server', true],
        ['maintenance', 503, { code: 'maintenance_mode', message: 'Trackly is upgrading' }, true, 'maintenance', false],
        ['socket reset', 0, {}, true, 'network', true],
        ['request timeout', -1, {}, true, 'timeout', true],
        ['false not found server error', 500, { error: 'Job not found' }, true, 'server', true],
        ['unknown failure', 402, { error: 'private-other-error' }, true, 'unknown', false],
      ]) {
        fixture = { status, body, headers };
        events.length = 0;
        const before = requests.length;
        const result = await client.callTool({ name, arguments: { [field]: 42 } });
        assert.equal(result.isError === true, expectedError, label);
        const payload = JSON.parse(result.content[0].text);
        assert.deepEqual(result.structuredContent, payload, `${label}: structured result`);
        assert.equal(requests.length, before + 1, `${label}: no automatic retries`);
        if (reason) {
          assert.equal(payload.success, true, label);
          assert.equal(payload.availability, 'unavailable', label);
          assert.equal(payload.reason, reason, label);
          assert.equal(payload.jobId, 42, label);
          assert.match(payload.message, /no longer available/i, label);
          assert.equal(payload.retryable, false, label);
          assert.equal(payload.maxRetries, 0, label);
          assert.equal(payload.nextStep.tool, 'trackly_search_jobs', label);
          assert.match(payload.nextStep.message, /do not retry/i, label);
          if (label === 'closed brief') {
            assert.equal(payload.brief.companyName, 'Example');
            assert.deepEqual(payload.brief.companySignal, { openRoleCount: 7 });
            assert.equal(payload.brief.actions, undefined);
            assert.equal(payload.brief.nextActions, undefined);
            assert.equal(payload.brief.recommendedMotion, undefined);
          }
        } else if (expectedError) {
          assert.equal(payload.category, category, label);
          assert.equal(payload.retryable, retryable, label);
          assert.equal(payload.maxRetries, retryable ? 1 : 0, label);
          if (retryable) assert.ok(payload.retryAfterSeconds >= 5, label);
          if (label === 'default rate delay') assert.equal(payload.retryAfterSeconds, 60);
          if (label === 'longer rate limit') assert.equal(payload.retryAfterSeconds, 600);
          if (label === 'longer access delay' || label === 'header rate delay') assert.equal(payload.retryAfterSeconds, 600);
          if (['header server delay', 'header access delay', 'body delay wins'].includes(label)) assert.equal(payload.retryAfterSeconds, 900);
          if (label === 'date header delay') assert.ok(payload.retryAfterSeconds > 3500 && payload.retryAfterSeconds <= 3600);
          if (label === 'invalid header delay') assert.equal(payload.retryAfterSeconds, 60);
          if (label === 'longer server delay') assert.equal(payload.retryAfterSeconds, 90);
          assert.equal(payload.status, status > 0 ? status : undefined, label);
          assert.ok(payload.nextStep.message, label);
          assert.doesNotMatch(JSON.stringify(payload), /private-|20 natural language queries/);
        } else {
          assert.deepEqual(payload, body, label);
        }
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(events.some((event) => event.event === '$exception'), expectedError, label);
      }

      delete process.env.TRACKLY_API_KEY;
      const beforeUnauthenticated = requests.length;
      const unauthenticated = await client.callTool({ name, arguments: { [field]: 42 } });
      assert.equal(unauthenticated.isError, true);
      assert.equal(unauthenticated.structuredContent.category, 'authentication');
      assert.equal(unauthenticated.structuredContent.maxRetries, 0);
      assert.equal(requests.length, beforeUnauthenticated, 'missing credentials must not reach HTTP');

      for (const refresh of ['success', 'failed', 'absent']) {
        saveConfig({ token: 'fixture_old', ...(refresh !== 'absent' ? { refreshToken: 'fixture_refresh' } : {}) });
        fixture = { refresh, status: 404, body: { success: false, error: 'Job not found' } };
        const before = requests.length;
        const result = await client.callTool({ name, arguments: { [field]: 42 } });
        assert.equal(result.isError === true, refresh !== 'success', refresh);
        assert.equal(result.structuredContent.retryable, false);
        assert.equal(result.structuredContent.maxRetries, 0);
        assert.deepEqual(requests.slice(before), refresh === 'success'
          ? [name === 'trackly_get_job' ? '/api/jobscout/jobs/42' : '/api/jobscout/jobs/42/network-brief',
            '/api/auth/refresh',
            name === 'trackly_get_job' ? '/api/jobscout/jobs/42' : '/api/jobscout/jobs/42/network-brief']
          : refresh === 'failed'
            ? [name === 'trackly_get_job' ? '/api/jobscout/jobs/42' : '/api/jobscout/jobs/42/network-brief', '/api/auth/refresh']
            : [name === 'trackly_get_job' ? '/api/jobscout/jobs/42' : '/api/jobscout/jobs/42/network-brief']);
        if (refresh === 'success') assert.equal(result.structuredContent.availability, 'unavailable');
        else assert.equal(result.structuredContent.category, 'authentication');
        assert.doesNotMatch(JSON.stringify(result), /private-/);
        saveConfig({});
      }
      process.env.TRACKLY_API_KEY = 'trk_job_fixture';

      for (const value of ['42', 'ats-id', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const before = requests.length;
        const result = await client.callTool({ name, arguments: { [field]: value } });
        assert.equal(result.isError, true, `invalid ID ${value}`);
        assert.equal(requests.length, before, 'invalid IDs must never reach the API');
      }
    });
  }
});
