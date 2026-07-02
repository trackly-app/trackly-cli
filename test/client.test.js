'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const client = require('../lib/client');
const { withEnv, createTempConfigDir } = require('./helpers');

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

// ─── single-flight refresh (PR 0.4.0) ────────────────────────────────────────
// Concurrent 401s in the long-lived MCP server must coalesce into ONE backend
// refresh. Without the single-flight latch, two parallel POSTs race; the backend
// rotates the refresh token, so the second uses a stale token, 4xx, clearOAuthTokens,
// and the user is silently logged out mid-session.
test('refreshAccessToken single-flights concurrent calls into one backend POST', async (t) => {
  let refreshCount = 0;
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    if (req.url === '/api/auth/refresh') {
      refreshCount++;
      // Delay so both Promise.all callers enter refreshAccessToken before the
      // first _doRefresh resolves — the latch must hand the second the same promise.
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, token: 'jwt_new', refreshToken: 'rt_new' }));
      }, 50);
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '2000',
  }, async () => {
    client.saveConfig({ token: 'jwt_old', refreshToken: 'rt_old' });
    const [a, b] = await Promise.all([client.refreshAccessToken(), client.refreshAccessToken()]);
    assert.equal(a, 'jwt_new');
    assert.equal(b, 'jwt_new', 'both concurrent callers get the same rotated token');
    assert.equal(refreshCount, 1, 'concurrent refreshes must coalesce into ONE backend POST');
  });
});

test('apiRequest rejects 3xx redirects with a clear message', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 302;
    res.setHeader('Location', '/somewhere-else');
    res.end();
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: 'trk_k',
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    // apiRequest rejects with a plain object (same shape as the >=400 path), so
    // inspect fields directly rather than assert.rejects(RegExp), which only
    // matches Error instances.
    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'must reject on a 3xx redirect');
    assert.equal(caught.status, 302, 'status preserved');
    assert.match(caught.message, /Unexpected redirect \(HTTP 302\)/);
  });
});

test('apiRequest surfaces planned maintenance details from 503 responses', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', '900');
    res.end(JSON.stringify({
      success: false,
      code: 'planned_maintenance',
      error: 'Trackly is upgrading',
      message: 'We will be back shortly.',
      estimatedReturn: 'Sunday 4:00 AM PT',
      retryAfterSeconds: 900,
    }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: 'trk_k',
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'must reject on planned maintenance');
    assert.equal(caught.status, 503);
    assert.equal(caught.code, 'planned_maintenance');
    assert.equal(caught.maintenance.title, 'Trackly is upgrading');
    assert.equal(caught.maintenance.message, 'We will be back shortly.');
    assert.equal(caught.maintenance.estimatedReturnPt, 'Sunday 4:00 AM PT');
    assert.equal(caught.maintenance.retryAfterSeconds, 900);
    assert.equal(caught.error, caught.message);
    assert.match(caught.message, /Trackly is upgrading/);
    assert.match(caught.message, /We will be back shortly\./);
    assert.match(caught.message, /Sunday 4:00 AM PT/);
  });
});

test('apiRequest parses HTTP-date Retry-After on planned maintenance', async (t) => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-06-21T10:00:00Z');
  t.after(() => { Date.now = originalNow; });

  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', 'Sun, 21 Jun 2026 10:15:00 GMT');
    res.end(JSON.stringify({
      code: 'planned_maintenance',
      message: 'We will be back shortly.',
    }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: 'trk_k',
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'must reject on planned maintenance');
    assert.equal(caught.maintenance.retryAfterSeconds, 900);
    assert.match(caught.message, /Retry in about 15 minutes\./);
  });
});

test('apiRequest hides the planned maintenance sentinel code from user-facing title', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'planned_maintenance',
      message: 'We will be back shortly.',
    }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: 'trk_k',
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'must reject on planned maintenance');
    assert.equal(caught.maintenance.title, 'Trackly is upgrading');
    assert.match(caught.message, /Trackly is upgrading/);
    assert.match(caught.message, /We will be back shortly\./);
    assert.doesNotMatch(caught.message, /planned_maintenance/);
  });
});

test('apiRequest handles null JSON 503 bodies without crashing', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end('null');
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: 'trk_k',
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }
    assert.deepEqual(caught, { status: 503 });
  });
});

test('apiRequest propagates planned maintenance from token refresh without clearing credentials', async (t) => {
  const { configDir, port } = await setupRefreshTestHarness(t, (req, res) => {
    if (req.url === '/api/auth/refresh') {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', '900');
      res.end(JSON.stringify({
        code: 'planned_maintenance',
        error: 'Trackly is upgrading',
        message: 'We will be back shortly.',
      }));
      return;
    }

    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Expired token' }));
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: `http://127.0.0.1:${port}`,
    TRACKLY_HTTP_TIMEOUT_MS: '1000',
  }, async () => {
    client.saveConfig({ token: 'jwt_expired', refreshToken: 'rt_keep' });

    let caught;
    try {
      await client.apiRequest('GET', '/api/jobscout/jobs');
    } catch (e) {
      caught = e;
    }

    assert.equal(caught?.code, 'planned_maintenance');
    assert.match(caught.message, /We will be back shortly\./);
    assert.equal(client.getToken(), 'jwt_expired');
    assert.equal(client.getRefreshToken(), 'rt_keep');
  });
});

test('loadConfig surfaces an unreadable config (EACCES) as a clear TracklyConfigError', async (t) => {
  const configDir = createTempConfigDir();
  const file = path.join(configDir, 'config.json');
  t.after(() => {
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  await withEnv({
    TRACKLY_CONFIG_DIR: configDir,
    TRACKLY_API_KEY: undefined,
    TRACKLY_BASE_URL: undefined,
  }, async () => {
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    fs.chmodSync(file, 0o000);
    // chmod 000 doesn't block root; detect that and assert accordingly so the
    // test is robust whether or not it runs privileged (CI runs unprivileged).
    let readable = true;
    try { fs.readFileSync(file, 'utf8'); } catch (_) { readable = false; }
    if (readable) {
      assert.deepEqual(client.loadConfig(), {}, 'privileged reader: still parses');
    } else {
      assert.throws(() => client.loadConfig(), /not readable|permissions/);
    }
  });
});
