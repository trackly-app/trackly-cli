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
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TracklyConfigError(`Trackly config is invalid JSON. Fix or delete ${file}.`);
    }
    throw error;
  }
  return {};
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
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (e) {}
}

function clearConfig() {
  const { file } = getConfigPaths();
  try { fs.unlinkSync(file); } catch (e) {}
}

function getBaseUrl() {
  return process.env.TRACKLY_BASE_URL || loadConfig().baseUrl || DEFAULT_BASE_URL;
}

function getApiKey() {
  return process.env.TRACKLY_API_KEY || loadConfig().apiKey || null;
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

async function refreshAccessToken() {
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
  } catch (e) {}
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
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        let json;
        try { json = body ? JSON.parse(body) : {}; } catch { json = { raw: body }; }

        if (res.statusCode === 401 && !skipAuth && authMethod === 'token' && !_isRetry) {
          // Try token refresh (once only)
          const newToken = await refreshAccessToken();
          if (newToken) {
            try {
              const retried = await apiRequest(method, endpoint, data, false, true, userAgent);
              return resolve(retried);
            } catch (e) { return reject(e); }
          }
        }

        if (res.statusCode >= 400) {
          reject({ status: res.statusCode, ...json });
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
  ensureSecureUrl,
  getApiKey,
  getAuthHeader,
  getAuthMethod,
  getBaseUrl,
  getConfigPaths,
  getRequestHeaders,
  getRequestTimeoutMs,
  getToken,
  hasAuth,
  loadConfig,
  normalizeEndpoint,
  saveConfig,
  CONFIG_DIR: DEFAULT_CONFIG_DIR,
  CONFIG_FILE: path.join(DEFAULT_CONFIG_DIR, 'config.json'),
};
