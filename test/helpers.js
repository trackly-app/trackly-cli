'use strict';

// Shared test helpers. Extracted so client.test.js, cli-integration.test.js and
// formatters.test.js all use one source of truth (previously withEnv /
// createTempConfigDir were duplicated inside client.test.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'trackly');

// Temporarily set env vars for the duration of fn (sync or async), then restore.
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

// Write a config.json into a temp dir so a spawned CLI authenticates via the
// stored API key (mode 0600, matching the real client).
function seedApiKey(dir, apiKey = 'trk_test_key_1234567890') {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey }), { mode: 0o600 });
  return apiKey;
}

// Start an HTTP mock bound to 127.0.0.1 on an OS-assigned port. Resolves only
// AFTER the listen callback fires (so a child can connect without racing).
function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Run the CLI as a child process. MUST be async execFile, NOT spawnSync — a sync
// child blocks this process's event loop, so an in-process mock server could never
// answer the child's HTTP request and the child would time out. Resolves
// { code, stdout, stderr } on BOTH success and non-zero exit (promisified execFile
// rejects on nonzero, so we normalize that here).
function runCli(args, env = {}, opts = {}) {
  const childEnv = { ...process.env };
  // Clean slate for TRACKLY_* so the developer's real config never leaks in.
  for (const k of ['TRACKLY_API_KEY', 'TRACKLY_BASE_URL', 'TRACKLY_CONFIG_DIR', 'TRACKLY_HTTP_TIMEOUT_MS', 'TRACKLY_NO_WARN']) {
    delete childEnv[k];
  }
  Object.assign(childEnv, env);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN_PATH, ...args],
      { env: childEnv, timeout: opts.timeout || 5000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            code: typeof err.code === 'number' ? err.code : 1,
            stdout: stdout || '',
            stderr: stderr || '',
            error: err,
          });
        } else {
          resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' });
        }
      }
    );
  });
}

module.exports = { BIN_PATH, withEnv, createTempConfigDir, seedApiKey, startMockServer, runCli };
