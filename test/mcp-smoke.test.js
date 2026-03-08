'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'trackly');

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
