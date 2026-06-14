'use strict';

// End-to-end CLI tests: spawn bin/trackly against an in-process HTTP mock and
// assert the request line the CLI builds (flag → query-param / body mapping) and
// its exit behavior. This closes the gap that let the v0.2.1 flag-mapping
// regression ship — no test previously exercised a command handler end-to-end.
//
// The harness uses ASYNC execFile (via runCli), never spawnSync: a sync child
// blocks this process's event loop, so the in-process mock could never answer
// and the child would time out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createTempConfigDir, seedApiKey, startMockServer, runCli } = require('./helpers');

// Spin up a temp config (seeded API key) + mock server, run the CLI, return the
// captured requests and the child result. `respond(req)` may return {status, json}.
async function runAgainstMock(t, args, respond) {
  const dir = createTempConfigDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedApiKey(dir);

  const requests = [];
  const { server, port } = await startMockServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      const r = (respond && respond(req)) || { status: 200, json: {} };
      res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.json || {}));
    });
  });
  t.after(() => server.close());

  const result = await runCli(args, {
    TRACKLY_CONFIG_DIR: dir,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
  });
  return { requests, result };
}

// Parse the query string of the (single) captured request.
function query(requests) {
  const u = new URL(requests[0].url, 'http://x');
  return u.searchParams;
}

test('jobs maps every filter flag to the right query param', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['jobs', '--function', 'product', '--region', 'us', '--job-type', 'internship', '--company', '243', '--keywords', 'fintech'],
    () => ({ status: 200, json: { jobs: [] } })
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  const q = query(requests);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/jobs');
  assert.equal(q.get('jobFunction'), 'product');
  assert.equal(q.get('locationFilter'), 'us');
  assert.equal(q.get('jobModality'), 'internship');
  assert.equal(q.get('companyId'), '243');
  assert.equal(q.get('search'), 'fintech');
});

test('jobs --remote maps to usStates=REMOTE', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--remote'], () => ({ status: 200, json: { jobs: [] } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(query(requests).get('usStates'), 'REMOTE');
});

test('jobs --remote --region conflict exits non-zero and makes no request', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--remote', '--region', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /cannot be combined/);
  assert.equal(requests.length, 0, 'must fail before any API call');
});

test('deprecated --location is rejected with a migration hint (regression guard)', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--location', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--location was removed/);
  assert.equal(requests.length, 0);
});

test('apply/save/dismiss POST the correct tracker stage', async (t) => {
  for (const [action, stage] of [['apply', 'applied'], ['save', 'backlog'], ['dismiss', 'discarded']]) {
    const { requests, result } = await runAgainstMock(t, [action, '1234'], () => ({ status: 200, json: { ok: true } }));
    assert.equal(result.code, 0, `${action}: ${result.stderr}`);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/jobscout/tracker/jobs/1234/stage');
    assert.equal(JSON.parse(requests[0].body).stage, stage, `${action} → stage=${stage}`);
  }
});

test('companies search hits the semantic search endpoint with q', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['companies', 'search', 'fintech'], () => ({ status: 200, json: { companies: [] } }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/companies/search');
  assert.equal(new URL(requests[0].url, 'http://x').searchParams.get('q'), 'fintech');
});

test('request-company POSTs source:"cli" and the company name', async (t) => {
  const { requests, result } = await runAgainstMock(
    t,
    ['request-company', 'Built Robotics', '--url', 'https://builtrobotics.com', '--notes', 'mba'],
    () => ({ status: 200, json: { requestId: 1 } })
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/api/jobscout/companies/request');
  const sent = JSON.parse(requests[0].body);
  assert.equal(sent.source, 'cli');
  assert.equal(sent.company_name, 'Built Robotics');
  assert.equal(sent.company_url, 'https://builtrobotics.com');
});

test('ask sends the natural-language query to the /ask endpoint (url-encoded)', async (t) => {
  // Note: the CLI's jobsUrl allowlist-follow runs only in human/TTY mode; under a
  // piped child stdout (non-TTY) `ask` returns the raw JSON result, so this test
  // covers the in-scope query mapping. (The MCP server applies the allowlist
  // unconditionally; that path is unchanged by this PR.)
  const { requests, result } = await runAgainstMock(t, ['ask', 'pm jobs at fintech'], () => ({
    status: 200,
    json: { parsedFilters: { jobFunction: 'product' }, jobsUrl: '/api/jobscout/jobs?x=1' },
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].url.split('?')[0], '/api/jobscout/ask');
  assert.equal(new URL(requests[0].url, 'http://x').searchParams.get('q'), 'pm jobs at fintech');
});

test('--json mode emits parseable JSON on stdout', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--json'], () => ({ status: 200, json: { jobs: [{ id: 1, title: 'PM' }] } }));
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed[0].id, 1);
});

test('unknown flag is rejected with a did-you-mean suggestion', async (t) => {
  const { requests, result } = await runAgainstMock(t, ['jobs', '--regoin', 'us']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown option --regoin/);
  assert.match(result.stderr, /Did you mean --region/);
  assert.equal(requests.length, 0);
});

test('a valid flag on the wrong command is rejected', async (t) => {
  const { result } = await runAgainstMock(t, ['jobs', '--url', 'x']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown option --url/);
});
