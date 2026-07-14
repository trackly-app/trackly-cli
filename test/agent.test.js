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

test('agent doctor inspection rejects stale Codex and Claude MCP commands', () => {
  withTempAgentHome(() => {
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME, 'config.toml'),
      '[mcp_servers.trackly]\ncommand = "node"\nargs = ["old-server.js"]\n',
    );
    fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'),
      JSON.stringify({ mcpServers: { trackly: { command: 'node', args: ['old-server.js'] } } }),
    );

    assert.equal(agent.inspectClient('codex').mcpRegistration, 'stale');
    assert.equal(agent.inspectClient('codex').mcpRegistered, false);
    assert.equal(agent.inspectClient('claude').mcpRegistration, 'stale');
    assert.equal(agent.inspectClient('claude').mcpRegistered, false);
  });
});

test('agent doctor inspection accepts only the exact Trackly MCP command', () => {
  withTempAgentHome(() => {
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME, 'config.toml'),
      '[mcp_servers.trackly]\ncommand = "trackly"\nargs = ["mcp"]\n',
    );
    fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'),
      JSON.stringify({ mcpServers: { trackly: { command: 'trackly', args: ['mcp'] } } }),
    );

    assert.equal(agent.inspectClient('codex').mcpRegistration, 'current');
    assert.equal(agent.inspectClient('claude').mcpRegistration, 'current');
  });
});

test('agent setup rejects a current MCP registration when the client executable is missing', () => {
  withTempAgentHome(() => {
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.CODEX_HOME, 'config.toml'),
      '[mcp_servers.trackly]\ncommand = "trackly"\nargs = ["mcp"]\n',
    );

    const result = agent.setupAgent('codex');

    assert.equal(result.clients[0].mcp.status, 'missing_client');
    assert.match(result.clients[0].mcp.error, /codex is not installed/);
  });
});

test('agent setup resolves a relative Trackly config directory before symlinking', () => {
  withTempAgentHome((root) => {
    const previousCwd = process.cwd();
    process.chdir(root);
    process.env.TRACKLY_CONFIG_DIR = '.trackly';
    try {
      const result = agent.setupAgent('codex');
      assert.equal(path.isAbsolute(result.canonical), true);
      assert.equal(path.isAbsolute(agent.cacheDir()), true);
      assert.equal(agent.cacheDir(), path.resolve('.trackly', 'cache', 'resumes'));
      assert.ok(fs.existsSync(path.join(result.clients[0].target, 'SKILL.md')));
    } finally {
      process.chdir(previousCwd);
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

test('agent setup refuses to overwrite an unmanaged client skill symlink', () => {
  withTempAgentHome((root) => {
    const unmanaged = path.join(root, 'user-owned-trackly-apply');
    fs.mkdirSync(unmanaged, { recursive: true });
    fs.writeFileSync(path.join(unmanaged, 'SKILL.md'), 'user-owned');
    const target = agent.clientSkillDir('codex');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(unmanaged, target, 'dir');
    assert.throws(() => agent.setupAgent('codex'), /Refusing to overwrite unmanaged skill/);
    assert.equal(fs.readlinkSync(target), unmanaged);
    assert.equal(fs.readFileSync(path.join(unmanaged, 'SKILL.md'), 'utf8'), 'user-owned');
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

test('agent setup never exposes a partial skill when fallback copying fails', () => {
  withTempAgentHome(() => {
    const originalSymlink = fs.symlinkSync;
    const originalCopyFile = fs.copyFileSync;
    let copies = 0;
    fs.symlinkSync = () => {
      const error = new Error('symlinks unavailable');
      error.code = 'ENOTSUP';
      throw error;
    };
    fs.copyFileSync = (...args) => {
      copies += 1;
      if (copies === 2) throw new Error('simulated interrupted copy');
      return originalCopyFile(...args);
    };
    try {
      const target = agent.clientSkillDir('codex');
      assert.throws(() => agent.setupAgent('codex'), /simulated interrupted copy/);
      assert.equal(fs.existsSync(target), false);
      const parent = path.dirname(target);
      const leftovers = fs.existsSync(parent)
        ? fs.readdirSync(parent).filter((entry) => entry.startsWith('trackly-apply.staging.'))
        : [];
      assert.deepEqual(leftovers, []);
    } finally {
      fs.symlinkSync = originalSymlink;
      fs.copyFileSync = originalCopyFile;
    }
  });
});

test('agent setup restores the previous managed copy when replacement copying fails', () => {
  withTempAgentHome(() => {
    const originalSymlink = fs.symlinkSync;
    const originalCopyFile = fs.copyFileSync;
    fs.symlinkSync = () => {
      const error = new Error('symlinks unavailable');
      error.code = 'ENOTSUP';
      throw error;
    };
    try {
      const first = agent.setupAgent('codex');
      const target = first.clients[0].target;
      fs.writeFileSync(path.join(target, 'sentinel.txt'), 'previous-good-copy');
      fs.copyFileSync = (source, destination, ...rest) => {
        if (destination.includes(`${path.sep}.codex${path.sep}skills${path.sep}trackly-apply.staging.`)) {
          throw new Error('simulated replacement failure');
        }
        return originalCopyFile(source, destination, ...rest);
      };
      assert.throws(() => agent.setupAgent('codex'), /simulated replacement failure/);
      assert.equal(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'previous-good-copy');
    } finally {
      fs.symlinkSync = originalSymlink;
      fs.copyFileSync = originalCopyFile;
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

test('resume validation normalizes generic MIME types from file signatures', () => {
  const pdf = Buffer.from('%PDF-1.7\nexample');
  assert.equal(agent.validateResumeFile({ buffer: pdf, contentType: 'application/octet-stream' }).contentType, 'application/pdf');
  const docx = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('[Content_Types].xml\0word/document.xml'),
  ]);
  assert.equal(
    agent.validateResumeFile({ buffer: docx, contentType: '' }).contentType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.throws(
    () => agent.validateResumeFile({ buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]), contentType: 'application/zip' }),
    /Unsupported or invalid resume type/,
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
