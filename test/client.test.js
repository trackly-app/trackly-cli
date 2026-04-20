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

// ─── refreshAccessToken behavior (PR #20) ─────────────────────────────────────
// Covers the three branches: 4xx from /api/auth/refresh clears the config, a
// 2xx-with-no-token response also clears (CodeRabbit/Cursor/Copilot caught this
// silently left a dead token on disk), and a network error preserves the token
// so transient connectivity blips don't log the user out.

function setupRefreshTestHarness(t, handler) {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ configDir, port: server.address().port });
    });
  });
}

test('refreshAccessToken clears config on 401 from /api/auth/refresh', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_grant' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    client.saveConfig({ token: 'jwt', refreshToken: 'rt_dead' });
    assert.equal(client.getRefreshToken(), 'rt_dead');

    const out = await client.refreshAccessToken();
    assert.equal(out, null, 'refresh should return null on 401');
    assert.equal(client.getRefreshToken(), null, 'dead refresh token must be cleared from disk');
    assert.equal(client.getToken(), null, 'access token must be cleared alongside');
  });
});

test('refreshAccessToken clears config on 2xx response with no token', async (t) => {
  // Regression: original code had a comment promising "fall through to clearConfig()" but
  // the only clearConfig() lived in the catch block, so a 200 { success: false } response
  // silently left the dead refresh token on disk and every subsequent 401 re-triggered the
  // same doomed refresh. Caught by Copilot + Cursor Bugbot + CodeRabbit on PR #20.
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, code: 'invalid_grant' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    client.saveConfig({ token: 'jwt', refreshToken: 'rt_dead_but_2xx' });

    const out = await client.refreshAccessToken();
    assert.equal(out, null, 'refresh should return null when body has no token');
    assert.equal(client.getRefreshToken(), null, 'clearConfig must fire on 2xx-with-no-token');
    assert.equal(client.getToken(), null);
  });
});

test('refreshAccessToken preserves config on network error (transient)', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  // Point at a closed port so connect() fails synchronously with ECONNREFUSED.
  // No t.after() server.close — we never actually listen.
  const deadPort = await (async () => {
    const probe = http.createServer(() => {});
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  })();

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${deadPort}`,
    TRACKLY_HTTP_TIMEOUT_MS: '500',
  }, async () => {
    client.saveConfig({ token: 'jwt_keep', refreshToken: 'rt_keep' });

    const out = await client.refreshAccessToken();
    assert.equal(out, null, 'refresh should return null on network error');
    assert.equal(
      client.getRefreshToken(),
      'rt_keep',
      'transient network error must NOT clear the refresh token (ECONNREFUSED, DNS, etc.)'
    );
    assert.equal(client.getToken(), 'jwt_keep', 'access token must also stay on disk');
  });
});

test('refreshAccessToken updates config on successful token issuance', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, token: 'jwt_new', refreshToken: 'rt_new' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    client.saveConfig({ token: 'jwt_old', refreshToken: 'rt_old' });

    const out = await client.refreshAccessToken();
    assert.equal(out, 'jwt_new');
    assert.equal(client.getToken(), 'jwt_new');
    assert.equal(client.getRefreshToken(), 'rt_new', 'rotated refresh token must be persisted');
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
