'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const client = require('../lib/client');

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createTempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-cli-test-'));
}

test('API keys take precedence over stored OAuth tokens', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: undefined,
    TRACKLY_HTTP_TIMEOUT_MS: undefined,
  }, async () => {
    client.saveConfig({
      apiKey: 'trk_local_key',
      token: 'jwt_token',
    });

    assert.equal(client.getAuthMethod(), 'apiKey');
    assert.equal(client.getRequestHeaders().Authorization, 'Bearer trk_local_key');
  });
});

test('apiRequest rejects insecure non-localhost credential transport', async () => {
  await withEnv({
    TRACKLY_API_KEY: 'trk_live_key',
    TRACKLY_BASE_URL: 'http://example.com',
  }, async () => {
    await assert.rejects(
      client.apiRequest('GET', '/api/jobscout/jobs'),
      /Refusing to send credentials over insecure connection/
    );
  });
});

test('apiRequest times out stalled requests', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  const server = http.createServer(() => {
    // Intentionally never respond so the client timeout fires.
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const port = server.address().port;

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '50',
  }, async () => {
    await assert.rejects(
      client.apiRequest('GET', '/slow'),
      /Trackly request timed out after 50ms/
    );
  });
});
