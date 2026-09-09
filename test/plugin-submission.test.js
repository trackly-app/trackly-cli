'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/verify-plugin-submission.js');
function load(overrides = {}) {
  const sandbox = { require: (name) => overrides[name] || require(name), module: { exports: {} }, __dirname: path.dirname(script), process, console, Buffer, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(script, 'utf8') + '\nmodule.exports.wellKnownAuthorizationServerUrl = wellKnownAuthorizationServerUrl; module.exports.sameOrParentOrigin = sameOrParentOrigin; module.exports.containsCredentialAssignment = containsCredentialAssignment; module.exports.request = request; module.exports.main = main; module.exports.validateAssetsAndTree = validateAssetsAndTree;', sandbox);
  return sandbox.module.exports;
}
const state = () => ({ errors: [], warnings: [] });
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
function network(handler) {
  return { request(options, callback) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = (error) => req.emit('error', error);
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.setEncoding = () => {};
      res.destroy = (error) => res.emit('error', error);
      const result = handler(options);
      if (result.error) return req.emit('error', new Error(result.error));
      res.statusCode = result.status || 200; res.headers = result.headers || {};
      callback(res);
      if (result.hang) return;
      res.emit('data', result.body || ''); res.emit('end');
    });
    return req;
  } };
}
test('malformed listing metadata reports errors without throwing', () => {
  const api = load(); const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.interface.capabilities = [];
  const s = state(); assert.doesNotThrow(() => api.validateManifest(s, manifest, null));
  assert(s.errors.some((e) => /metadata|listing/.test(e)));
});
test('rejects malformed fixture members without throwing', () => {
  const fixtures = json('plugins/trackly/listing/submission-tests.json');
  fixtures.negative[0] = null; fixtures.reviewEnvironment.portalCaseBriefs[0] = null;
  const s = state(); assert.doesNotThrow(() => load().validateSubmissionTests(s, fixtures)); assert(s.errors.length);
});
test('arbitrary files do not count as skills', () => {
  const api = load({ 'node:fs': { ...fs, readdirSync: () => [{ name: '.gitkeep', isDirectory: () => false }] } });
  const s = state(); api.validateSkills(s); assert(s.errors.some((e) => /at least one skill/.test(e)));
});
test('non-square SVG fails', () => {
  const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { const value = fs.readFileSync(file, ...args); return String(file).endsWith('.svg') ? '<svg viewBox="0 0 1024 512"></svg>' : value; } } });
  const s = state(); api.validateAssetsAndTree(s); assert(s.errors.some((e) => /square viewBox/.test(e)));
});
test('unknown and empty flags fail', async () => {
  const api = load();
  assert.equal(await api.main(['--json', '--strict-origin']), 1);
  assert.equal(await api.main(['--json', '--challenge-base-url=']), 1);
});
test('public page follows HTTPS redirect and rejects insecure redirect', async () => {
  for (const insecure of [false, true]) {
    const api = load({ 'node:https': network((o) => o.path === '/old' ? { status: 301, headers: { location: insecure ? 'http://example.com/new' : '/new' } } : { status: 200 }) });
    const s = state(); await api.checkPublicPage(s, 'https://example.com/old', 'page');
    assert.equal(s.errors.length === 0, !insecure);
  }
});
test('request rejects body overflow and total deadline', async () => {
  const oversized = load({ 'node:https': network(() => ({ body: '12345' })) });
  await assert.rejects(oversized.request('https://example.com', { maxBodyBytes: 2 }), /exceeded/);
  const hanging = load({ 'node:https': network(() => ({ hang: true })) });
  await assert.rejects(hanging.request('https://example.com', { timeout: 10 }), /timed out/);
});
test('strict origin probes reject non-401 and network failures', async () => {
  for (const outcome of [{ status: 500 }, { error: 'offline' }]) {
    const api = load({ 'node:https': network((o) => {
      if (o.headers.origin) return outcome;
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { strictOrigins: true, checkPublicPages: false });
    assert.equal(s.errors.filter((e) => /origin/i.test(e)).length, 4);
  }
});
test('credential scan detects assignments across chunk boundaries and skips oversize files', () => {
  const target = path.join(root, 'plugins/trackly/synthetic.txt');
  for (const oversized of [false, true]) {
    const content = Buffer.from('x'.repeat(65530) + '\nOPENAI_API_KEY' + ' '.repeat(70000) + '= synthetic-test-value');
    let offset = 0; let opened = false;
    const fakeFs = { ...fs,
      readdirSync(dir, options) { return dir === path.dirname(target) ? [{ name: 'synthetic.txt', isDirectory: () => false, isFile: () => true }] : fs.readdirSync(dir, options); },
      statSync(file) { return file === target ? { size: oversized ? 101 * 1024 * 1024 : content.length, isFile: () => true } : fs.statSync(file); },
      openSync(file, flags) { if (file !== target) return fs.openSync(file, flags); opened = true; return -123; },
      readSync(fd, buffer, start, length, position) { if (fd !== -123) return fs.readSync(fd, buffer, start, length, position); const count = content.copy(buffer, start, offset, offset + length); offset += count; return count; },
      closeSync(fd) { if (fd !== -123) fs.closeSync(fd); },
    };
    const s = state(); load({ 'node:fs': fakeFs }).validateAssetsAndTree(s);
    assert.equal(opened, !oversized);
    assert(s.errors.some((e) => oversized ? /exceeds 100 MiB/.test(e) : /credential assignment/.test(e)));
  }
});
test('malformed top-level JSON becomes validation errors', () => {
  for (const suffix of ['plugin.json', 'metadata.json', '.mcp.json']) {
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith(suffix) ? 'null' : fs.readFileSync(file, ...args); } } });
    let result; assert.doesNotThrow(() => { result = api.runStatic(); }); assert(result.errors.length);
  }
});
test('live discovery rejects JSON null and arrays', async () => {
  for (const body of ['null', '[]']) {
    const api = load({ 'node:https': network((o) => o.method === 'POST' ? { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } } : { body }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    assert(s.errors.some((e) => /protected-resource metadata must be a JSON object/.test(e)));
  }
});

test('credential scan rejects quoted shell values without treating empty quotes as credentials', () => {
  for (const value of ['"synthetic-value"', "'synthetic-value'", '""', "''"]) {
    let read = false;
    const content = Buffer.from('OPENAI_API_KEY=' + value);
    const api = load({ 'node:fs': { ...fs, openSync: () => -123, closeSync: () => {}, readSync(fd, buffer) {
      if (read) return 0; read = true; content.copy(buffer); return content.length;
    } } });
    const result = api.containsCredentialAssignment('synthetic');
    assert.equal(result, value.length > 2, value);
  }
});

test('rejected challenge origin is never probed', async () => {
  const contacted = [];
  const api = load({ 'node:https': network((options) => { contacted.push(options.hostname); return { status: 401 }; }) });
  const s = state();
  await api.runLive(s, { challengeBaseUrl: 'https://unrelated.example', checkPublicPages: false });
  assert(s.errors.some((error) => /parent-domain/.test(error)));
  assert.equal(contacted.includes('unrelated.example'), false);
});

test('known credentials are detected in JSON and YAML assignments', () => {
  for (const prefix of ['"OPENAI_API_KEY": ', "'MCP_REVIEW_LOGIN_PASSWORD': ", 'NPM_TOKEN: ']) {
    for (const value of ['"synthetic-value"', 'synthetic-value', '""']) {
      let read = false;
      const content = Buffer.from(prefix + value);
      const api = load({ 'node:fs': { ...fs, openSync: () => -123, closeSync: () => {}, readSync(fd, buffer) {
        if (read) return 0; read = true; content.copy(buffer); return content.length;
      } } });
      assert.equal(api.containsCredentialAssignment('synthetic'), value !== '""', prefix + value);
    }
  }
});
test('live-only flags require explicit live mode', async () => {
  for (const flag of ['--strict-origins', '--require-challenge', '--challenge-base-url=https://example.com']) {
    assert.equal(await load().main(['--json', flag]), 1, flag);
  }
});

test('challenge origin accepts only the MCP host or approved Trackly parent', () => {
  const api = load();
  const child = 'https://mcp.usetrackly.app/api/plugin/trackly/mcp';
  assert.equal(api.sameOrParentOrigin('https://mcp.usetrackly.app', child), true);
  assert.equal(api.sameOrParentOrigin('https://usetrackly.app', child), true);
  for (const candidate of ['https://app', 'https://unrelated.app', 'https://usetrackly.app:8443']) {
    assert.equal(api.sameOrParentOrigin(candidate, child), false, candidate);
  }
});

test('tree walk stops at the rejected depth boundary', () => {
  let deepestRead = 0;
  const pluginRoot = path.join(root, 'plugins/trackly');
  const api = load({ 'node:fs': { ...fs, readdirSync(dir) {
    const depth = path.relative(pluginRoot, dir).split(path.sep).filter(Boolean).length;
    deepestRead = Math.max(deepestRead, depth);
    assert(depth <= 20, 'must not read a directory already rejected as too deep');
    return [{ name: 'nested', isDirectory: () => true, isFile: () => false }];
  } } });
  const s = state(); api.validateAssetsAndTree(s);
  assert(s.errors.some(error => /too deep/.test(error)));
  assert.equal(deepestRead, 20);
});

test('credential names accept punctuation boundaries but exclude longer identifiers', () => {
  for (const key of ['MCP_REVIEW_LOGIN_PASSWORD', 'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'OPENAI_API_KEY']) {
    for (const [prefix, suffix, expected] of [['{', '', true], [',', '', true], [';', '', true], ['prefix_', '', false], ['', '_suffix', false]]) {
      let read = false;
      const content = Buffer.from(`${prefix}${key}${suffix}=synthetic-value`);
      const api = load({ 'node:fs': { ...fs, openSync: () => -123, closeSync: () => {}, readSync(fd, buffer) {
        if (read) return 0; read = true; content.copy(buffer); return content.length;
      } } });
      assert.equal(api.containsCredentialAssignment('synthetic'), expected, `${prefix}${key}${suffix}`);
    }
  }
});

test('authorization-server issuer rejects query and fragment rather than dropping them', () => {
  const api = load();
  assert.equal(api.wellKnownAuthorizationServerUrl('https://example.com/issuer'), 'https://example.com/.well-known/oauth-authorization-server/issuer');
  for (const issuer of ['https://example.com/issuer?tenant=a', 'https://example.com/issuer#tenant']) {
    assert.throws(() => api.wellKnownAuthorizationServerUrl(issuer), /query|fragment/i);
  }
});

test('strict origin 401 challenges require matching HTTPS Bearer resource metadata', async () => {
  const canonical = 'Bearer resource_metadata="https://example.com/resource"';
  for (const challenge of [undefined, 'Basic realm="Trackly"', 'Bearer resource_metadata="http://example.com/resource"', 'Bearer resource_metadata="https://example.com/other"', canonical]) {
    const api = load({ 'node:https': network((o) => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': o.headers.origin ? challenge : canonical } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { strictOrigins: true, checkPublicPages: false });
    assert.equal(s.errors.filter((e) => /origin/i.test(e)).length, challenge === canonical ? 0 : 4, String(challenge));
  }
});

test('screenshots reject non-array, missing file, and escaping paths', () => {
  for (const screenshots of ['not-an-array', ['./assets/does-not-exist.png'], ['../outside.png']]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    manifest.interface.screenshots = screenshots;
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) {
      return String(file).endsWith('/.codex-plugin/plugin.json') ? JSON.stringify(manifest) : fs.readFileSync(file, ...args);
    } } });
    const s = state(); api.validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json')); api.validateAssetsAndTree(s);
    assert(s.errors.some((e) => /screenshot|does-not-exist|outside/.test(e)), JSON.stringify(screenshots));
  }
});

test('default prompts accept documented string/list forms and reject undocumented alias', () => {
  const metadata = json('plugins/trackly/listing/metadata.json');
  for (const [field, value] of [['defaultPrompt', 'Find remote jobs'], ['defaultPrompt', ['Find remote jobs']]]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    delete manifest.interface.defaultPrompt;
    manifest.interface[field] = value;
    const s = state(); load().validateManifest(s, manifest, metadata);
    assert.equal(s.errors.length, 0, s.errors.join('\n'));
  }
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.interface.default_prompt = 'Find remote jobs';
  const s = state(); load().validateManifest(s, manifest, metadata);
  assert(s.errors.some((e) => /default_prompt.*not accepted/.test(e)));
});

test('required challenge matches the expected token exactly without printing token values', async () => {
  for (const [expectedChallenge, body, valid] of [['synthetic-expected-token', 'synthetic-expected-token', true], ['synthetic-expected-token', 'synthetic-other-token', false], ['synthetic-expected-token', 'synthetic-expected-token\n', false], ['', 'synthetic-other-token', false]]) {
    const api = load({ 'node:https': network((o) => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { body };
    }) });
    const s = state(); await api.runLive(s, { requireChallenge: true, expectedChallenge, checkPublicPages: false });
    assert.equal(s.errors.length === 0, valid, s.errors.join('\n'));
    assert.doesNotMatch(JSON.stringify(s), /synthetic-(?:expected|other)-token/);
  }
});

test('CLI required challenge without expected token fails before any network request', async () => {
  let requests = 0;
  const previous = process.env.OPENAI_CHALLENGE_TOKEN;
  delete process.env.OPENAI_CHALLENGE_TOKEN;
  try {
    const api = load({ 'node:https': network(() => { requests += 1; return { status: 404 }; }) });
    assert.equal(await api.main(['--json', '--require-challenge', '--live']), 1);
    assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_CHALLENGE_TOKEN;
    else process.env.OPENAI_CHALLENGE_TOKEN = previous;
  }
});

test('documented multiline descriptions and optional support URL remain valid', () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  const metadata = json('plugins/trackly/listing/metadata.json');
  manifest.interface.longDescription += '\nA second paragraph.';
  manifest.interface.supportURL = metadata.supportURL;
  const valid = state(); load().validateManifest(valid, manifest, metadata);
  assert.deepEqual(valid.errors, []);
  manifest.interface.longDescription += '\u0000';
  manifest.interface.supportURL = 'http://example.com';
  const invalid = state(); load().validateManifest(invalid, manifest, metadata);
  assert(invalid.errors.some(error => /longDescription.*unsupported/.test(error)));
  assert(invalid.errors.some(error => /supportURL.*HTTPS/.test(error)));
});
