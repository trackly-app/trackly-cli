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

test('apiRequest aborts oversized response body (PR v0.2.4)', async (t) => {
  // The 10 MB body cap prevents a malicious TRACKLY_BASE_URL from OOM'ing the long-lived
  // MCP process via unbounded streaming. We simulate by returning chunks that exceed the
  // cap; the client must reject with a specific error and NOT crash.
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Send a single 11 MB chunk. Node's body-buffer grows past MAX_BODY_BYTES (10 MB)
    // on the first chunk event and the client calls req.destroy.
    const chunk = Buffer.alloc(11 * 1024 * 1024, '{');
    res.write(chunk);
    res.end('}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '5000',
  }, async () => {
    await assert.rejects(
      client.apiRequest('GET', '/oversized'),
      /Trackly response body exceeded/,
      'oversized body must reject with a specific, identifiable error (not swallow into OOM)'
    );
  });
});

test('apiRequest rejection: HTTP statusCode wins over body `status` key (Cursor Bugbot #5)', async (t) => {
  // Regression: apiRequest used to reject with `{ status: res.statusCode, ...json }` — spread
  // came AFTER, so a backend body like `{"status":"error"}` would clobber the numeric HTTP
  // status with a string. Downstream code checking `typeof e.status === 'number'` then
  // skipped the 400/401/403 token-clear branch, and dead refresh tokens stayed on disk.
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', error: 'invalid_grant', message: 'token dead' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    let caught;
    try {
      await client.apiRequest('POST', '/api/auth/refresh', { refreshToken: 'rt' }, true);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'apiRequest must reject on 401');
    assert.equal(typeof caught.status, 'number', 'status must stay numeric even when body has status:string');
    assert.equal(caught.status, 401, 'HTTP statusCode must win over body.status');
    assert.equal(caught.error, 'invalid_grant', 'body fields still accessible');
  });
});

test('refreshAccessToken clears tokens on 401 even when body has status:string (Bugbot #5 integration)', async (t) => {
  // End-to-end guard for the spread-order bug: the full refresh path must clear tokens on
  // 401 even when the backend returns `{"status":"error"}` in the body. Before the spread
  // fix, this test would have failed because typeof e.status === 'number' was false.
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'error', error: 'invalid_grant' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    client.saveConfig({ token: 'jwt', refreshToken: 'rt_dead', baseUrl: 'https://k.com' });
    const out = await client.refreshAccessToken();
    assert.equal(out, null);
    assert.equal(client.getRefreshToken(), null, 'tokens must clear even when body.status overrides');
    assert.equal(client.loadConfig().baseUrl, 'https://k.com');
  });
});

test('refreshAccessToken clears tokens on 401 but preserves baseUrl', async (t) => {
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
    // Seed a non-default baseUrl on disk so we can assert it survives the refresh failure.
    // The env-var baseUrl (set above for the fake server) overrides getBaseUrl(), but
    // loadConfig().baseUrl reads the raw file — which is what Bugbot flagged as getting
    // wiped by the old clearConfig() call.
    client.saveConfig({
      token: 'jwt',
      refreshToken: 'rt_dead',
      baseUrl: 'https://custom.usetrackly.app',
    });
    assert.equal(client.getRefreshToken(), 'rt_dead');

    const out = await client.refreshAccessToken();
    assert.equal(out, null, 'refresh should return null on 401');
    assert.equal(client.getRefreshToken(), null, 'dead refresh token must be cleared from disk');
    assert.equal(client.getToken(), null, 'access token must be cleared alongside');
    assert.equal(
      client.loadConfig().baseUrl,
      'https://custom.usetrackly.app',
      'user-configured baseUrl must survive a token refresh failure (Cursor Bugbot PR #20)'
    );
  });
});

test('refreshAccessToken clears tokens on 2xx-with-no-token but preserves baseUrl + apiKey', async (t) => {
  // Regression: original code had a comment promising "fall through to clearConfig()" but
  // the only clearConfig() lived in the catch block, so a 200 { success: false } response
  // silently left the dead refresh token on disk and every subsequent 401 re-triggered the
  // same doomed refresh. Caught by Copilot + Cursor Bugbot + CodeRabbit on PR #20.
  // Post-fix Bugbot catch: clearConfig() wiped the whole file including baseUrl/apiKey —
  // now using clearOAuthTokens() for a surgical delete.
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
    client.saveConfig({
      token: 'jwt',
      refreshToken: 'rt_dead_but_2xx',
      baseUrl: 'https://staging.usetrackly.app',
      apiKey: 'trk_preserved_key',
    });

    const out = await client.refreshAccessToken();
    assert.equal(out, null, 'refresh should return null when body has no token');
    assert.equal(client.getRefreshToken(), null, 'dead refresh token must be cleared');
    assert.equal(client.getToken(), null);
    const onDisk = client.loadConfig();
    assert.equal(onDisk.baseUrl, 'https://staging.usetrackly.app', 'baseUrl must survive');
    assert.equal(onDisk.apiKey, 'trk_preserved_key', 'apiKey must survive a token expiry');
  });
});

test('clearOAuthTokens removes file when no non-auth keys remain', async (t) => {
  const configDir = createTempConfigDir();
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: undefined,
  }, async () => {
    // OAuth-only config — no baseUrl/apiKey/etc. After clearing tokens, nothing is left
    // worth persisting, so the file should be unlinked (keeps behavior backward-compatible
    // with the old clearConfig() full-delete for this common "logout" case).
    client.saveConfig({ token: 'jwt', refreshToken: 'rt' });
    client.clearOAuthTokens();
    const configFile = client.getConfigPaths().file;
    assert.equal(fs.existsSync(configFile), false, 'empty post-clear config should be unlinked');
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
