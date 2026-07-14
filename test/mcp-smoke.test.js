'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createErrorResult, createServer, throwMcpResourceError } = require('../mcp/server');
const { createMaintenanceError } = require('../lib/client');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'trackly');

test('local MCP error results preserve bounded canonical maintenance context', () => {
  const result = createErrorResult({
    status: 503,
    httpStatus: 503,
    serviceStatus: 'maintenance',
    code: 'maintenance_mode',
    sourceCode: 'maintenance_mode',
    error: 'Trackly is migrating. Retry in about 5 minutes.',
    message: 'Trackly is migrating. Retry in about 5 minutes.',
    estimatedReturn: '10:00 AM PT',
    retryAfterSeconds: 300,
    requestId: 'req-local-mcp',
    retryable: false,
    guidance: 'Resume the existing run; never create a duplicate.',
    maintenance: {
      status: 'maintenance',
      httpStatus: 503,
      code: 'maintenance_mode',
      sourceCode: 'maintenance_mode',
      title: 'Trackly is upgrading',
      message: 'Trackly is migrating.',
      estimatedReturn: '10:00 AM PT',
      estimatedReturnPt: '10:00 AM PT',
      retryAfterSeconds: 300,
      requestId: 'req-local-mcp',
      retryable: false,
      guidance: 'Resume the existing run; never create a duplicate.',
    },
  }, 'Failed to fetch apply protocol');

  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, 'maintenance_mode');
  assert.equal(payload.status, 503);
  assert.equal(payload.serviceStatus, 'maintenance');
  assert.equal(payload.retryAfterSeconds, 300);
  assert.equal(payload.estimatedReturn, '10:00 AM PT');
  assert.equal(payload.requestId, 'req-local-mcp');
  assert.equal(payload.retryable, false);
  assert.match(payload.guidance, /never create a duplicate/i);
});

test('local MCP resource errors use JSON-RPC -32002 with structured maintenance data', () => {
  const maintenanceError = createMaintenanceError({
    status: 'maintenance',
    code: 'maintenance_mode',
    message: 'The Apply protocol is temporarily unavailable.',
    estimatedReturn: '10:20 AM PT',
    retryAfterSeconds: 240,
    requestId: 'req-resource-mcp',
  }, { status: 503 });

  assert.throws(
    () => throwMcpResourceError(maintenanceError),
    (error) => {
      assert.equal(error.code, -32002);
      assert.equal(error.data.code, 'maintenance_mode');
      assert.equal(error.data.status, 503);
      assert.equal(error.data.serviceStatus, 'maintenance');
      assert.equal(error.data.retryAfterSeconds, 240);
      assert.equal(error.data.estimatedReturn, '10:20 AM PT');
      assert.equal(error.data.requestId, 'req-resource-mcp');
      assert.equal(error.data.retryable, false);
      assert.match(error.data.guidance, /resume the existing agent_browser run/);
      return true;
    },
  );
});

test('trackly://apply/protocol preserves maintenance through the real MCP resource transport', async (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-mcp-resource-test-'));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const httpServer = http.createServer((req, res) => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', '180');
    res.setHeader('X-Request-Id', 'req-live-resource');
    res.end(JSON.stringify({
      status: 'maintenance',
      code: 'maintenance_mode',
      message: 'The Apply protocol is paused.',
      estimatedReturn: '10:30 AM PT',
    }));
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  t.after(() => httpServer.close());

  const originalEnv = {
    TRACKLY_CONFIG_DIR: process.env.TRACKLY_CONFIG_DIR,
    TRACKLY_API_KEY: process.env.TRACKLY_API_KEY,
    TRACKLY_BASE_URL: process.env.TRACKLY_BASE_URL,
  };
  process.env.TRACKLY_CONFIG_DIR = configDir;
  process.env.TRACKLY_API_KEY = 'trk_test_resource';
  process.env.TRACKLY_BASE_URL = `http://127.0.0.1:${httpServer.address().port}`;
  t.after(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createServer();
  const mcpClient = new Client({ name: 'trackly-maintenance-test', version: '1.0.0' });
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  t.after(async () => {
    await mcpClient.close().catch(() => {});
    await mcpServer.close().catch(() => {});
  });

  await assert.rejects(
    mcpClient.readResource({ uri: 'trackly://apply/protocol' }),
    (error) => {
      assert.equal(error.code, -32002);
      assert.equal(error.data.code, 'maintenance_mode');
      assert.equal(error.data.status, 503);
      assert.equal(error.data.serviceStatus, 'maintenance');
      assert.equal(error.data.retryAfterSeconds, 180);
      assert.equal(error.data.estimatedReturn, '10:30 AM PT');
      assert.equal(error.data.requestId, 'req-live-resource');
      return true;
    },
  );
});

test('trackly mcp starts and stays attached to stdio', async (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-mcp-test-'));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  const child = spawn(process.execPath, [BIN_PATH, 'mcp'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      TRACKLY_CONFIG_DIR: configDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  t.after(async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      try {
        await once(child, 'exit');
      } catch (error) {}
    }
  });

  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 300);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`trackly mcp exited early with code ${code} and signal ${signal}`));
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.includes('MCP server error:')) {
        clearTimeout(timer);
        reject(new Error(text.trim()));
      }
    });
  });

  await assert.doesNotReject(startup);
});
