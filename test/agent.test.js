'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agent = require('../lib/agent');

function withTempAgentHome(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-agent-test-'));
  const previous = {
    TRACKLY_CONFIG_DIR: process.env.TRACKLY_CONFIG_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    PATH: process.env.PATH,
  };
  process.env.TRACKLY_CONFIG_DIR = path.join(root, '.trackly');
  process.env.CODEX_HOME = path.join(root, '.codex');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
  process.env.PATH = path.join(root, 'empty-bin');
  fs.mkdirSync(process.env.PATH, { recursive: true });
  try {
    return run(root);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('agent setup installs one canonical skill and links both clients', () => {
  withTempAgentHome(() => {
    const result = agent.setupAgent('both');
    assert.equal(result.skillVersion, '1.0.0');
    assert.ok(fs.existsSync(path.join(result.canonical, 'SKILL.md')));
    assert.equal(result.clients.length, 2);
    for (const client of result.clients) {
      assert.ok(fs.existsSync(path.join(client.target, 'SKILL.md')));
      assert.equal(client.mcp.status, 'missing_client');
    }
  });
});

test('agent setup refuses to overwrite an unmanaged client skill', () => {
  withTempAgentHome(() => {
    const target = agent.clientSkillDir('codex');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'user-owned');
    assert.throws(() => agent.setupAgent('codex'), /Refusing to overwrite unmanaged skill/);
    assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'user-owned');
  });
});

test('agent setup falls back to a private managed copy when symlinks are unavailable', () => {
  withTempAgentHome(() => {
    const originalSymlink = fs.symlinkSync;
    fs.symlinkSync = () => {
      const error = new Error('symlinks unavailable');
      error.code = 'EPERM';
      throw error;
    };
    try {
      const result = agent.setupAgent('codex');
      assert.equal(result.clients[0].method, 'copy');
      assert.ok(fs.existsSync(path.join(result.clients[0].target, '.trackly-managed.json')));
      assert.equal(fs.statSync(result.canonical).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(result.canonical, '.trackly-managed.json')).mode & 0o777, 0o600);
    } finally {
      fs.symlinkSync = originalSymlink;
    }
  });
});

test('resume validation checks PDF type and server hash', () => {
  const buffer = Buffer.from('%PDF-1.7\nexample');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  assert.deepEqual(agent.validateResumeFile({ buffer, contentType: 'application/pdf', sha256 }), {
    digest: sha256,
    contentType: 'application/pdf',
  });
  assert.throws(
    () => agent.validateResumeFile({ buffer, contentType: 'application/pdf', sha256: '0'.repeat(64) }),
    /SHA-256/,
  );
});

test('resume cache removes only expired files', () => {
  withTempAgentHome(() => {
    const dir = agent.cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, 'old.pdf');
    const freshFile = path.join(dir, 'fresh.pdf');
    fs.writeFileSync(oldFile, '%PDF-old');
    fs.writeFileSync(freshFile, '%PDF-fresh');
    const now = Date.now();
    fs.utimesSync(oldFile, new Date(now - agent.CACHE_TTL_MS - 1000), new Date(now - agent.CACHE_TTL_MS - 1000));
    const result = agent.cleanResumeCache(now);
    assert.equal(result.removed, 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(freshFile), true);
  });
});

test('public skill contains no personal profile data or absolute user paths', () => {
  const root = agent.bundledSkillDir();
  const files = [];
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(item);
      else if (entry.isFile()) files.push(item);
    }
  }
  collect(root);
  const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(text, /Kevin|Astuhuaman|berkeley\.edu|2710 Bancroft|\/Users\//i);
  assert.match(text, /Stop before Submit/);
});
