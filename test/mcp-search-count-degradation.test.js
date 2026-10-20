'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('real stdio search preserves pages when only their total is unavailable', { timeout: 20_000 }, async (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-search-count-'));
  const calls = [];
  let fixture;
  const api = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url.startsWith('/api/jobscout/jobs')) calls.push(request.url);
    response.writeHead(fixture.status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(fixture.body));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => api.close(resolve));
    fs.rmSync(configDir, { recursive: true, force: true });
  });
  const degraded = {
    success: true, jobs: [{ id: 301, title: 'Product manager' }, { id: 302, title: 'Product manager II' }],
    total: null, countStatus: 'unavailable',
    countGuidance: 'The matching jobs are available, but the total is temporarily unavailable. Use hasMore and pagination to continue; do not retry this search just to obtain a total.',
    hasMore: true, pagination: { total: null, limit: 2, offset: 4, hasMore: true },
    recencyStats: { available: false, totalActive: null },
  };
  const zero = { success: true, jobs: [], total: 0, hasMore: false,
    pagination: { total: 0, limit: 2, offset: 4, hasMore: false } };
  for (const analyticsDisabled of [true, false]) {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [path.join(__dirname, '..', 'bin', 'trackly'), 'mcp'],
      env: {
        TRACKLY_BASE_URL: `http://127.0.0.1:${api.address().port}`,
        TRACKLY_API_KEY: 'trk_synthetic_search', TRACKLY_CONFIG_DIR: configDir,
        TRACKLY_MCP_ANALYTICS_DISABLED: analyticsDisabled ? '1' : '0',
      },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr.on('data', chunk => { stderr += String(chunk); });
    const client = new Client({ name: 'search-count-fixture', version: '1.0.0' });
    try {
      await client.connect(transport);
      const discovery = await client.listTools();
      assert.match(discovery.tools.find(tool => tool.name === 'trackly_search_jobs').description, /total.*unavailable/i);
      for (const body of [degraded, zero]) {
        fixture = { status: 200, body };
        const before = calls.length;
        const result = await client.callTool({ name: 'trackly_search_jobs', arguments: {
          keywords: 'product manager', limit: 2, offset: 4,
        } });
        assert.notEqual(result.isError, true);
        assert.deepEqual(JSON.parse(result.content[0].text), body);
        assert.equal(calls.length, before + 1, 'one page request without a count retry');
        const query = new URL(calls.at(-1), 'http://fixture.invalid').searchParams;
        assert.equal(query.get('search'), 'product manager');
        assert.equal(query.get('offset'), '4');
      }
      fixture = { status: 503, body: { success: false, error: 'Failed to fetch jobs' } };
      const before = calls.length;
      const result = await client.callTool({ name: 'trackly_search_jobs', arguments: { limit: 2 } });
      assert.equal(result.isError, true);
      assert.equal(calls.length, before + 1, 'a real page failure remains an error without retries');
    } finally {
      await client.close();
      await transport.close();
    }
    assert.equal(stderr, '');
  }
});
