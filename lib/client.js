'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.trackly');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_BASE_URL = 'https://closeai.mba';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function clearConfig() {
  try { fs.unlinkSync(CONFIG_FILE); } catch (e) {}
}

function getBaseUrl() {
  return loadConfig().baseUrl || DEFAULT_BASE_URL;
}

function getToken() {
  return loadConfig().token || null;
}

function getRefreshToken() {
  return loadConfig().refreshToken || null;
}

async function refreshAccessToken() {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
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

function apiRequest(method, endpoint, data = null, skipAuth = false) {
  return new Promise((resolve, reject) => {
    const baseUrl = getBaseUrl();
    const url = new URL(endpoint, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'trackly-cli/0.1.0',
    };

    if (!skipAuth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        let json;
        try { json = JSON.parse(body); } catch { json = { raw: body }; }

        if (res.statusCode === 401 && !skipAuth) {
          // Try token refresh
          const newToken = await refreshAccessToken();
          if (newToken) {
            try {
              const retried = await apiRequest(method, endpoint, data, false);
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

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

module.exports = { loadConfig, saveConfig, clearConfig, apiRequest, getToken, CONFIG_DIR, CONFIG_FILE };
