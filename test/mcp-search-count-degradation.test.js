'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const SERVER_ENTRY = path.join(__dirname, '..', 'bin', 'trackly');
const ALLOWED_JOBS_URL = '/api/jobscout/jobs?limit=2';
const INVALID_JOBS_RESPONSE = {
  error: 'Trackly returned an unreadable job page for this search. The search did not complete; retry it, or use trackly_search_jobs with structured filters.',
  status: 502,
  code: 'invalid_jobs_response',
};

const degradedPage = {
  success: true, jobs: [{ id: 301, title: 'Product manager' }, { id: 302, title: 'Product manager II' }],
  total: null, countStatus: 'unavailable',
  countGuidance: 'The matching jobs are available, but the total is temporarily unavailable. Use hasMore and pagination to continue; do not retry this search just to obtain a total.',
  hasMore: true, pagination: { total: null, limit: 2, offset: 4, hasMore: true },
  recencyStats: { available: false, totalActive: null },
};
const lowerBoundPage = {
  ...degradedPage, total: 7, totalIsLowerBound: true,
  countGuidance: 'The total is a lower bound, not an exact count.',
  jobs: [{ id: 301, matchScore: null, matchScoreStatus: 'not_scored', matchScoreReason: 'parse_required' }],
  pagination: { ...degradedPage.pagination, total: 7, totalIsLowerBound: true },
};
const exactPage = {
  ...lowerBoundPage, total: 122, totalIsLowerBound: false,
  pagination: { ...lowerBoundPage.pagination, total: 122, totalIsLowerBound: false },
};
const zeroPage = {
  success: true, jobs: [], total: 0, hasMore: false,
  pagination: { total: 0, limit: 2, offset: 4, hasMore: false },
};

// The ask and jobs responses are configured separately, because the only
// behavior this suite exists to pin is how the two are combined. A single
// shared fixture cannot express a disagreement between them.
async function startFixture(t) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-search-count-'));
  const state = {
    ask: { status: 200, body: { success: true, jobsUrl: ALLOWED_JOBS_URL } },
    jobs: { status: 200, body: lowerBoundPage },
    askCalls: [],
    jobsCalls: [],
  };
  const api = http.createServer((request, response) => {
    const isAsk = request.url.startsWith('/api/jobscout/ask');
    const isJobs = request.url.startsWith('/api/jobscout/jobs') || request.url.startsWith('/api/v1/jobs');
    if (request.method === 'GET' && isAsk) state.askCalls.push(request.url);
    if (request.method === 'GET' && isJobs) state.jobsCalls.push(request.url);
    const reply = isAsk ? state.ask : state.jobs;
    response.writeHead(reply.status, { 'Content-Type': reply.contentType || 'application/json' });
    // `text` sends a body verbatim (non-JSON or empty); `body` is serialized.
    if (typeof reply.text === 'string') return response.end(reply.text);
    if (!Object.prototype.hasOwnProperty.call(reply, 'body')) return response.end();
    response.end(JSON.stringify(reply.body));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => api.close(resolve));
    fs.rmSync(configDir, { recursive: true, force: true });
  });
  state.baseUrl = `http://127.0.0.1:${api.address().port}`;
  state.configDir = configDir;
  return state;
}

// Every case runs against the real MCP server over real stdio, with analytics
// enabled and disabled, and requires an empty stderr: an MCP server that writes
// to stderr corrupts nothing here but has historically masked schema breakage.
async function withClient(fixture, run) {
  for (const analyticsDisabled of [true, false]) {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER_ENTRY, 'mcp'],
      env: {
        TRACKLY_BASE_URL: fixture.baseUrl,
        TRACKLY_API_KEY: 'trk_synthetic_search', TRACKLY_CONFIG_DIR: fixture.configDir,
        TRACKLY_MCP_ANALYTICS_DISABLED: analyticsDisabled ? '1' : '0',
      },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr.on('data', chunk => { stderr += String(chunk); });
    const client = new Client({ name: 'search-count-fixture', version: '1.0.0' });
    try {
      await client.connect(transport);
      await run(client, { analyticsDisabled });
    } finally {
      await client.close();
      await transport.close();
    }
    assert.equal(stderr, '');
  }
}

const payloadOf = (result) => JSON.parse(result.content[0].text);

test('real stdio search preserves pages when only their total is unavailable', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    const discovery = await client.listTools();
    assert.match(discovery.tools.find(tool => tool.name === 'trackly_search_jobs').description, /total.*unavailable/i);
    for (const body of [degradedPage, lowerBoundPage, exactPage, zeroPage]) {
      fixture.jobs = { status: 200, body };
      const before = fixture.jobsCalls.length;
      const result = await client.callTool({ name: 'trackly_search_jobs', arguments: {
        keywords: 'product manager', limit: 2, offset: 4,
      } });
      assert.notEqual(result.isError, true);
      assert.deepEqual(payloadOf(result), body);
      assert.equal(fixture.jobsCalls.length, before + 1, 'one page request without a count retry');
      const query = new URL(fixture.jobsCalls.at(-1), 'http://fixture.invalid').searchParams;
      assert.equal(query.get('search'), 'product manager');
      assert.equal(query.get('offset'), '4');
    }
    fixture.jobs = { status: 503, body: { success: false, error: 'Failed to fetch jobs' } };
    const before = fixture.jobsCalls.length;
    const failed = await client.callTool({ name: 'trackly_search_jobs', arguments: { limit: 2 } });
    assert.equal(failed.isError, true);
    assert.equal(fixture.jobsCalls.length, before + 1, 'a real page failure remains an error without retries');
  });
});

test('trackly_ask answers with the ask result plus only the documented page metadata', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: { success: true, jobsUrl: ALLOWED_JOBS_URL } };
    fixture.jobs = { status: 200, body: lowerBoundPage };
    const before = fixture.jobsCalls.length;
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.notEqual(ask.isError, true);
    assert.deepEqual(payloadOf(ask), {
      success: true,
      total: 7, totalIsLowerBound: true, countStatus: 'unavailable',
      countGuidance: lowerBoundPage.countGuidance,
      hasMore: true, pagination: lowerBoundPage.pagination,
      recencyStats: lowerBoundPage.recencyStats,
      jobs: lowerBoundPage.jobs,
      jobsUrl: ALLOWED_JOBS_URL,
      jobsUrlRefused: false,
    });
    assert.equal(fixture.jobsCalls.length, before + 1, 'one follow-on page request, no retry');
    assert.equal(fixture.jobsCalls.at(-1), ALLOWED_JOBS_URL, 'follows exactly the allowlisted path');
  });
});

test('trackly_ask preserves an unavailable count through the natural-language path', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: { success: true, jobsUrl: ALLOWED_JOBS_URL } };
    fixture.jobs = { status: 200, body: degradedPage };
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.notEqual(ask.isError, true);
    const payload = payloadOf(ask);
    assert.equal(payload.total, null);
    assert.equal(payload.countStatus, 'unavailable');
    assert.equal(payload.countGuidance, degradedPage.countGuidance);
    assert.equal(payload.hasMore, true);
    assert.deepEqual(payload.jobs, degradedPage.jobs);
    assert.equal(payload.jobsUrlRefused, false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'totalIsLowerBound'), false,
      'a page without the flag must not gain one');
  });
});

test('trackly_ask reads rows from a data-shaped page without reflecting the raw key', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    const dataPage = {
      data: [{ id: 401, title: 'Partnerships lead' }],
      total: 11, totalIsLowerBound: true, hasMore: true,
      pagination: { total: 11, limit: 2, offset: 0, hasMore: true, totalIsLowerBound: true },
    };
    fixture.ask = { status: 200, body: { success: true, jobsUrl: '/api/v1/jobs?limit=2' } };
    fixture.jobs = { status: 200, body: dataPage };
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.notEqual(ask.isError, true);
    assert.deepEqual(payloadOf(ask), {
      success: true,
      total: 11, totalIsLowerBound: true, hasMore: true, pagination: dataPage.pagination,
      jobs: dataPage.data,
      jobsUrl: '/api/v1/jobs?limit=2',
      jobsUrlRefused: false,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payloadOf(ask), 'data'), false,
      'the page list must not also appear under data');
  });
});

test('trackly_ask keeps ask-owned metadata when the followed page collides with it', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: {
      success: true,
      query: 'Synthetic query',
      parsedFilters: { jobFunction: 'product', region: ['us'] },
      jobsUrl: ALLOWED_JOBS_URL,
    } };
    fixture.jobs = { status: 200, body: {
      ...lowerBoundPage,
      query: 'page-owned query',
      parsedFilters: { jobFunction: 'legal' },
      error: 'page-owned error',
      raw: '<html>interstitial</html>',
      jobsUrl: '/api/admin/disallowed',
      jobsUrlRefused: true,
    } };
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.notEqual(ask.isError, true);
    const payload = payloadOf(ask);
    assert.equal(payload.query, 'Synthetic query', 'the ask parse owns query');
    assert.deepEqual(payload.parsedFilters, { jobFunction: 'product', region: ['us'] },
      'the ask parse owns parsedFilters');
    assert.equal(payload.success, true, 'the ask envelope owns success');
    assert.equal(payload.jobsUrl, ALLOWED_JOBS_URL, 'the handler owns the validated jobsUrl');
    assert.equal(payload.jobsUrlRefused, false, 'the handler owns the refusal breadcrumb');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'error'), false,
      'a page error key must not reach the agent');
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'raw'), false,
      'an unparsed page body must never be reflected');
    assert.equal(payload.total, 7, 'the page still owns its count metadata');
    assert.deepEqual(payload.jobs, lowerBoundPage.jobs);
  });
});

test('trackly_ask refuses a same-origin jobsUrl outside the job API', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: {
      success: true,
      parsedFilters: { jobFunction: 'product' },
      jobsUrl: '/api/auth/api-keys',
    } };
    fixture.jobs = { status: 200, body: lowerBoundPage };
    const before = fixture.jobsCalls.length;
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.notEqual(ask.isError, true);
    assert.deepEqual(payloadOf(ask), {
      success: true,
      parsedFilters: { jobFunction: 'product' },
      jobsUrl: null,
      jobsUrlRefused: true,
    });
    assert.equal(fixture.jobsCalls.length, before, 'a refused path is never fetched');
  });
});

test('trackly_ask fails loudly when the followed page is not a job page', { timeout: 30_000 }, async (t) => {
  const fixture = await startFixture(t);
  const unreadablePages = [
    { label: 'no jobs or data array', jobs: { status: 200, body: { success: true, total: 7, hasMore: true } } },
    { label: 'jobs is not an array', jobs: { status: 200, body: { success: true, jobs: { 0: { id: 1 } } } } },
    { label: 'invalid jobs cannot be hidden by data', jobs: { status: 200, body: { success: true, jobs: 'invalid', data: [] } } },
    { label: 'empty 2xx body', jobs: { status: 200, text: '' } },
    { label: 'non-JSON 2xx body', jobs: { status: 200, contentType: 'text/html', text: '<html><body>Access denied</body></html>' } },
    { label: '2xx body reporting failure', jobs: { status: 200, body: { success: false, error: 'Failed to fetch jobs' } } },
  ];
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: { success: true, jobsUrl: ALLOWED_JOBS_URL } };
    for (const unreadable of unreadablePages) {
      fixture.jobs = unreadable.jobs;
      const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
      assert.equal(ask.isError, true, `${unreadable.label} must be a tool error`);
      assert.deepEqual(payloadOf(ask), INVALID_JOBS_RESPONSE, `${unreadable.label} returns the fixed error`);
    }
  });
});

test('trackly_ask surfaces a follow-on page failure as a tool error', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    fixture.ask = { status: 200, body: { success: true, jobsUrl: ALLOWED_JOBS_URL } };
    fixture.jobs = { status: 503, body: { success: false, error: 'Failed to fetch jobs' } };
    const before = fixture.jobsCalls.length;
    const ask = await client.callTool({ name: 'trackly_ask', arguments: { query: 'Synthetic query' } });
    assert.equal(ask.isError, true);
    assert.equal(fixture.jobsCalls.length, before + 1, 'no retry after a failed follow-on page');
  });
});

test('trackly_ask discovery text does not promise pagination it cannot accept', { timeout: 20_000 }, async (t) => {
  const fixture = await startFixture(t);
  await withClient(fixture, async (client) => {
    const ask = (await client.listTools()).tools.find(tool => tool.name === 'trackly_ask');
    // `context` is the analytics field, present only when analytics is enabled.
    // Everything else would be a real input, and there is none: trackly_ask
    // cannot be paged, so its description must not tell an agent to page it.
    const inputs = Object.keys(ask.inputSchema.properties).filter(key => key !== 'context');
    assert.deepEqual(inputs, ['query'], 'trackly_ask takes only a query');
    for (const paging of ['offset', 'limit', 'cursor', 'page', 'after']) {
      assert.equal(Object.prototype.hasOwnProperty.call(ask.inputSchema.properties, paging), false,
        `trackly_ask has no ${paging} input`);
    }
    assert.match(ask.description, /one page/i);
    assert.match(ask.description, /trackly_search_jobs/);
    assert.doesNotMatch(ask.description, /use hasMore\/pagination/i);
  });
});
