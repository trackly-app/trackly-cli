'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { version: PACKAGE_VERSION } = require('../package.json');

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.trackly');
const DEFAULT_BASE_URL = 'https://closeai.mba';
const DEFAULT_HTTP_TIMEOUT_MS = 30000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const PLANNED_MAINTENANCE_CODE = 'planned_maintenance';

class TracklyConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TracklyConfigError';
  }
}

function getConfigPaths() {
  const dir = process.env.TRACKLY_CONFIG_DIR || DEFAULT_CONFIG_DIR;
  return {
    dir,
    file: path.join(dir, 'config.json'),
  };
}

function loadConfig() {
  const { file } = getConfigPaths();
  // Read the file directly rather than gating on fs.existsSync(): existsSync can
  // mask a permission error (and races the read). Distinguish "no config yet"
  // (ENOENT → {}) from "config exists but unreadable" (EACCES/EPERM → a clear,
  // actionable error) from "config is corrupt JSON".
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new TracklyConfigError(`Trackly config is not readable (${file}). Check file permissions.`);
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TracklyConfigError(`Trackly config is invalid JSON. Fix or delete ${file}.`);
    }
    throw error;
  }
}

function ensureConfigDir() {
  const { dir } = getConfigPaths();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try { fs.chmodSync(dir, 0o700); } catch (e) {}
  return dir;
}

function saveConfig(config) {
  ensureConfigDir();
  const { file } = getConfigPaths();
  // Atomic write: stage to a sibling temp file (same dir → same filesystem → rename is atomic
  // on POSIX) then rename into place. Without this, a crash or SIGKILL mid-write can leave
  // a zero-byte or partial config.json, and the next CLI invocation silently loses all auth.
  // Temp file is created mode 0600 so tokens are never world-readable, even briefly.
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (e) {}
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Best-effort cleanup of the temp file if rename fails; re-raise the original error.
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
  try { fs.chmodSync(file, 0o600); } catch (e) {}
}

function clearConfig() {
  const { file } = getConfigPaths();
  try { fs.unlinkSync(file); } catch (e) {}
}

// Surgical alternative to clearConfig() for the refresh-failure path. Deletes ONLY the
// OAuth credentials (token + refreshToken) while preserving everything else on disk
// (baseUrl, apiKey, timeout overrides, future keys). A refresh token being invalidated
// is not a reason to reset the user's `trackly config --base-url` choice — use this
// instead of clearConfig() when the only thing known to be dead is the session pair.
// Bug caught by Cursor Bugbot on PR #20: clearConfig() in refresh failure paths
// silently wiped baseUrl alongside the dead tokens.
function clearOAuthTokens() {
  const config = loadConfig();
  delete config.token;
  delete config.refreshToken;
  // If nothing else is persisted (e.g. user only ever logged in via OAuth and never set
  // a custom baseUrl), unlink the file so getConfigPaths().file doesn't linger as an
  // empty {} on disk. Otherwise preserve the remaining keys.
  if (Object.keys(config).length === 0) {
    const { file } = getConfigPaths();
    try { fs.unlinkSync(file); } catch (e) {}
    return;
  }
  saveConfig(config);
}

function getBaseUrl() {
  return process.env.TRACKLY_BASE_URL || loadConfig().baseUrl || DEFAULT_BASE_URL;
}

function getApiKey() {
  return (process.env.TRACKLY_API_KEY || loadConfig().apiKey || '').trim() || null;
}

function getToken() {
  return loadConfig().token || null;
}

function getRefreshToken() {
  return loadConfig().refreshToken || null;
}

function getAuthMethod() {
  if (getApiKey()) return 'apiKey';
  if (getToken()) return 'token';
  return null;
}

function hasAuth() {
  return Boolean(getAuthMethod());
}

function getAuthHeader(skipAuth = false) {
  if (skipAuth) return null;

  const apiKey = getApiKey();
  if (apiKey) return `Bearer ${apiKey}`;

  const token = getToken();
  if (token) return `Bearer ${token}`;

  return null;
}

function normalizeEndpoint(endpoint, baseUrl = getBaseUrl()) {
  const base = new URL(baseUrl);
  const url = new URL(endpoint, base);

  if (url.origin !== base.origin) {
    throw new Error(
      `Refusing to send Trackly requests to a different origin (${url.origin}). ` +
      'Configure TRACKLY_BASE_URL or use `trackly config --base-url <url>` instead.'
    );
  }

  return url;
}

function isLocalHttpUrl(url) {
  return url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
}

function ensureSecureUrl(url, reason = 'credentials') {
  if (url.protocol === 'https:' || isLocalHttpUrl(url)) {
    return;
  }

  throw new Error(
    `Refusing to send ${reason} over insecure connection (${url.origin}). Use HTTPS or localhost.`
  );
}

function getRequestTimeoutMs() {
  const configuredValue = process.env.TRACKLY_HTTP_TIMEOUT_MS || loadConfig().timeoutMs;
  const timeoutMs = Number(configuredValue);

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  return DEFAULT_HTTP_TIMEOUT_MS;
}

function getRequestHeaders(skipAuth = false, userAgent = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': userAgent || `trackly-cli/${PACKAGE_VERSION}`,
  };

  const authHeader = getAuthHeader(skipAuth);
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  return headers;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanMaintenanceTitle(value) {
  const text = cleanText(value);
  return text && text !== PLANNED_MAINTENANCE_CODE ? text : null;
}

function cleanPositiveInt(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  const seconds = Math.ceil((retryAt - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

function normalizePlannedMaintenance(json, retryAfterHeader) {
  const record = json && typeof json === 'object' ? json : {};
  const source = record.maintenance && typeof record.maintenance === 'object' && record.maintenance !== null
    ? record.maintenance
    : {};
  return {
    title:
      cleanMaintenanceTitle(source.title) ||
      cleanMaintenanceTitle(source.error) ||
      cleanMaintenanceTitle(record.title) ||
      cleanMaintenanceTitle(record.error) ||
      'Trackly is upgrading',
    message:
      cleanText(source.message) ||
      cleanText(record.message) ||
      'We are moving Trackly onto stronger infrastructure. The service will be back shortly.',
    estimatedReturnPt:
      cleanText(source.estimatedReturnPt) ||
      cleanText(source.estimatedReturn) ||
      cleanText(source.estimated_return_pt) ||
      cleanText(source.estimated_return) ||
      cleanText(record.estimatedReturnPt) ||
      cleanText(record.estimatedReturn) ||
      cleanText(record.estimated_return_pt) ||
      cleanText(record.estimated_return),
    retryAfterSeconds:
      cleanPositiveInt(source.retryAfterSeconds) ||
      cleanPositiveInt(source.retry_after_seconds) ||
      cleanPositiveInt(record.retryAfterSeconds) ||
      cleanPositiveInt(record.retry_after_seconds) ||
      cleanPositiveInt(retryAfterHeader),
  };
}

function formatPlannedMaintenanceMessage(maintenance) {
  const parts = [maintenance.title, maintenance.message];
  if (maintenance.estimatedReturnPt) {
    parts.push(`Expected back around ${maintenance.estimatedReturnPt}.`);
  } else if (maintenance.retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(maintenance.retryAfterSeconds / 60));
    parts.push(`Retry in about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  return parts.join(' ');
}

function isPlannedMaintenanceResponse(statusCode, json) {
  const record = json && typeof json === 'object' ? json : {};
  return statusCode === 503 && (
    record.code === PLANNED_MAINTENANCE_CODE ||
    record.error === PLANNED_MAINTENANCE_CODE ||
    (record.maintenance !== null && typeof record.maintenance === 'object')
  );
}

// Single-flight wrapper around the refresh logic. Coalesces concurrent refreshes
// WITHIN THIS PROCESS so simultaneous 401s (e.g. parallel MCP tool calls in the
// long-lived stdio server) don't each fire `POST /api/auth/refresh`. The backend
// rotates the refresh token on use, so a second in-flight refresh would send a
// now-stale token → 4xx → clearOAuthTokens() → the user is silently logged out
// mid-session even though the first refresh succeeded. All concurrent callers
// await the same promise, then each retries reading the freshly-saved token.
//
// Scope: this does NOT coordinate across multiple `trackly` processes sharing
// ~/.trackly/config.json. That is acceptable — saveConfig() is atomic (renameSync)
// and concurrent multi-process refresh is rare; a cross-process file lock is a
// possible future addition, not in scope here.
let _refreshInFlight = null;
function refreshAccessToken() {
  if (_refreshInFlight) return _refreshInFlight;
  // _doRefresh resolves to a token-or-null for normal refresh outcomes. Planned
  // maintenance is intentionally rethrown so callers can surface the ETA instead
  // of converting it into an auth failure.
  _refreshInFlight = _doRefresh().finally(() => { _refreshInFlight = null; });
  return _refreshInFlight;
}

async function _doRefresh() {
  const rt = getRefreshToken();
  if (!rt) return null;

  try {
    ensureSecureUrl(normalizeEndpoint('/api/auth/refresh'), 'refresh tokens');
    const result = await apiRequest('POST', '/api/auth/refresh', { refreshToken: rt }, true);
    if (result.success && result.token) {
      const config = loadConfig();
      config.token = result.token;
      if (result.refreshToken) config.refreshToken = result.refreshToken;
      saveConfig(config);
      return result.token;
    }
    // Backend responded 2xx but didn't return a token (e.g. { success: false, code: 'invalid_grant' }).
    // Treat as an invalidated session and purge ONLY the OAuth pair so we don't retry on
    // every subsequent 401. Without this, a backend that signals failure via JSON instead of
    // a 4xx status would leave the user stuck in a doomed-refresh loop forever.
    // Use clearOAuthTokens() — NOT clearConfig() — so the user's baseUrl, apiKey, and any
    // other persisted settings survive a token expiry. (Bug caught by Cursor Bugbot on
    // PR #20 post-review: the earlier clearConfig() call silently wiped baseUrl too.)
    try { clearOAuthTokens(); } catch (_) {}
  } catch (e) {
    if (e?.code === PLANNED_MAINTENANCE_CODE) {
      throw e;
    }
    // A 401/invalid_grant on refresh means the token is permanently dead (rotation, manual
    // revocation, or session expired). Keeping it on disk makes every subsequent request
    // trigger another doomed refresh attempt — the user looks perpetually broken until they
    // `trackly logout`. Network errors (ECONNREFUSED, DNS) are transient and should NOT
    // purge the token. Surgical OAuth-only clear preserves baseUrl + apiKey + timeout overrides.
    const status = e && typeof e.status === 'number' ? e.status : null;
    if (status === 400 || status === 401 || status === 403) {
      try { clearOAuthTokens(); } catch (_) {}
    }
  }
  return null;
}

function apiRequest(method, endpoint, data = null, skipAuth = false, _isRetry = false, userAgent = null) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = normalizeEndpoint(endpoint);
    } catch (error) {
      reject(error);
      return;
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers = getRequestHeaders(skipAuth, userAgent);
    const authMethod = getAuthMethod();
    const timeoutMs = getRequestTimeoutMs();
    const hasSensitivePayload = Boolean(data && typeof data === 'object' && 'refreshToken' in data);

    try {
      if (headers['Authorization'] || hasSensitivePayload) {
        ensureSecureUrl(url, hasSensitivePayload ? 'refresh tokens' : 'credentials');
      }
    } catch (error) {
      reject(error);
      return;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      // Hard cap on response body size. A compromised / misconfigured backend (or a user-set
      // TRACKLY_BASE_URL pointing at a malicious host) could stream unbounded data and OOM
      // the long-lived MCP process. 10 MB is orders of magnitude larger than any real
      // Trackly response; jobs-list maxes out around ~200 KB for 50 items.
      const MAX_BODY_BYTES = 10 * 1024 * 1024;
      let body = '';
      let bytesReceived = 0;
      let aborted = false;
      // Handle socket-torn-down errors during streaming (happens when req.destroy()
      // fires to abort an oversized body). Without this, the orphan 'error' event on
      // the response stream can surface as an uncaught exception and crash the long-
      // lived MCP process. The request-level `req.on('error', reject)` below catches
      // the same underlying socket error for the request side; this covers the response
      // side. (CodeRabbit PR #21.)
      res.on('error', reject);
      res.on('data', (chunk) => {
        if (aborted) return;
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_BODY_BYTES) {
          aborted = true;
          req.destroy(new Error(`Trackly response body exceeded ${MAX_BODY_BYTES} bytes`));
          return;
        }
        body += chunk;
      });
      res.on('end', async () => {
        if (aborted) return; // req.destroy already rejected via 'error' handler

        let json;
        try {
          json = body ? JSON.parse(body) : {};
        } catch {
          // Non-JSON body (HTML error page, plaintext, proxy notice, …). Keep the
          // raw body for debugging but always attach a usable `message` so the
          // downstream `e.error || e.message || fallback` chain has real context.
          json = { raw: body, message: 'Received a non-JSON response from the Trackly API.' };
        }

        // The Trackly API is a same-origin JSON API that should never redirect on
        // the paths the CLI/MCP call. node:http does not auto-follow 3xx, so a
        // redirect would otherwise resolve as "success" with the redirect headers
        // as bogus data. Treat it as an error with a clear, actionable message.
        if (res.statusCode >= 300 && res.statusCode < 400) {
          return reject({
            status: res.statusCode,
            message: `Unexpected redirect (HTTP ${res.statusCode}) from the Trackly API.`,
          });
        }

        if (res.statusCode === 401 && !skipAuth && authMethod === 'token' && !_isRetry) {
          // Try token refresh (once only)
          let newToken;
          try {
            newToken = await refreshAccessToken();
          } catch (e) {
            return reject(e);
          }
          if (newToken) {
            try {
              const retried = await apiRequest(method, endpoint, data, false, true, userAgent);
              return resolve(retried);
            } catch (e) { return reject(e); }
          }
        }

        if (res.statusCode >= 400) {
          if (isPlannedMaintenanceResponse(res.statusCode, json)) {
            const maintenance = normalizePlannedMaintenance(json, res.headers['retry-after']);
            const message = formatPlannedMaintenanceMessage(maintenance);
            const record = json && typeof json === 'object' ? json : {};
            return reject({
              ...record,
              status: res.statusCode,
              code: PLANNED_MAINTENANCE_CODE,
              error: message,
              maintenance,
              message,
            });
          }
          // Spread `json` FIRST so the HTTP statusCode always wins. A backend that returns
          // `{"status": "error"}` in the body would otherwise clobber the numeric status with
          // a string, breaking downstream branches like `typeof e.status === 'number'` in
          // refreshAccessToken — which would silently skip the 400/401/403 token-clear and
          // leave dead refresh tokens on disk. (Cursor Bugbot finding #5 on PR #20.)
          const record = json && typeof json === 'object' ? json : {};
          reject({ ...record, status: res.statusCode });
        } else {
          resolve(json);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Trackly request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_CONFIG_DIR,
  DEFAULT_HTTP_TIMEOUT_MS,
  TracklyConfigError,
  apiRequest,
  clearConfig,
  clearOAuthTokens,
  ensureSecureUrl,
  getApiKey,
  getAuthHeader,
  getAuthMethod,
  getBaseUrl,
  getConfigPaths,
  getRefreshToken,
  getRequestHeaders,
  getRequestTimeoutMs,
  getToken,
  hasAuth,
  loadConfig,
  normalizeEndpoint,
  refreshAccessToken,
  saveConfig,
  CONFIG_DIR: DEFAULT_CONFIG_DIR,
  CONFIG_FILE: path.join(DEFAULT_CONFIG_DIR, 'config.json'),
};
