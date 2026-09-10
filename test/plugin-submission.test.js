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
test('arbitrary files do not count as skills', async () => {
  const api = load({ 'node:fs': { ...fs, readdirSync: () => [{ name: '.gitkeep', isDirectory: () => false }] } });
  const s = state(); await api.validateSkills(s); assert(s.errors.some((e) => /at least one skill/.test(e)));
});
test('non-square SVG fails', async () => {
  const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { const value = fs.readFileSync(file, ...args); return String(file).endsWith('.svg') ? Buffer.from('<svg viewBox="0 0 1024 512"></svg>') : value; } } });
  const s = state(); await api.validateAssetsAndTree(s); assert(s.errors.some((e) => /square/.test(e)));
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
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { strictOrigins: true, checkPublicPages: false });
    assert.equal(s.errors.filter((e) => /origin/i.test(e)).length, 4);
  }
});
test('credential scan detects assignments across chunk boundaries and skips oversize files', async () => {
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
    const s = state(); await load({ 'node:fs': fakeFs }).validateAssetsAndTree(s);
    assert.equal(opened, !oversized);
    assert(s.errors.some((e) => oversized ? /exceeds 100 MiB/.test(e) : /credential assignment/.test(e)));
  }
});
test('malformed top-level JSON becomes validation errors', async () => {
  for (const suffix of ['plugin.json', 'metadata.json', '.mcp.json']) {
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith(suffix) ? 'null' : fs.readFileSync(file, ...args); } } });
    const result = await api.runStatic(); assert(result.errors.length);
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

test('tree walk stops at the rejected depth boundary', async () => {
  let deepestRead = 0;
  const pluginRoot = path.join(root, 'plugins/trackly');
  const api = load({ 'node:fs': { ...fs, readdirSync(dir) {
    const depth = path.relative(pluginRoot, dir).split(path.sep).filter(Boolean).length;
    deepestRead = Math.max(deepestRead, depth);
    assert(depth <= 20, 'must not read a directory already rejected as too deep');
    return [{ name: 'nested', isDirectory: () => true, isFile: () => false }];
  } } });
  const s = state(); await api.validateAssetsAndTree(s);
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
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { strictOrigins: true, checkPublicPages: false });
    assert.equal(s.errors.filter((e) => /origin/i.test(e)).length, challenge === canonical ? 0 : 4, String(challenge));
  }
});

test('screenshots reject non-array, missing file, and escaping paths', async () => {
  for (const screenshots of ['not-an-array', ['./assets/does-not-exist.png'], ['../outside.png']]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    manifest.interface.screenshots = screenshots;
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) {
      return String(file).endsWith('/.codex-plugin/plugin.json') ? JSON.stringify(manifest) : fs.readFileSync(file, ...args);
    } } });
    const s = state(); api.validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json')); await api.validateAssetsAndTree(s);
    assert(s.errors.some((e) => /screenshot|does-not-exist|outside/.test(e)), JSON.stringify(screenshots));
  }
});

test('default prompts accept string/list aliases and reject conflicting aliases', () => {
  const metadata = json('plugins/trackly/listing/metadata.json');
  for (const [field, value] of [['defaultPrompt', 'Find remote jobs'], ['defaultPrompt', ['Find remote jobs']], ['default_prompt', 'Find remote jobs'], ['default_prompt', ['Find remote jobs']]]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    delete manifest.interface.defaultPrompt;
    manifest.interface[field] = value;
    const s = state(); load().validateManifest(s, manifest, metadata);
    assert.equal(s.errors.length, 0, s.errors.join('\n'));
  }
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.interface.default_prompt = 'Find remote jobs';
  const s = state(); load().validateManifest(s, manifest, metadata);
  assert(s.errors.some((e) => /defaultPrompt|default_prompt/i.test(e)));
  manifest.interface.defaultPrompt = ['Find remote jobs'];
  const equivalent = state(); load().validateManifest(equivalent, manifest, metadata);
  assert.deepEqual(equivalent.errors, []);
});

test('required challenge matches the expected token exactly without printing token values', async () => {
  for (const [expectedChallenge, body, valid] of [['synthetic-expected-token', 'synthetic-expected-token', true], ['synthetic-expected-token', 'synthetic-other-token', false], ['synthetic-expected-token', 'synthetic-expected-token\n', false], ['', 'synthetic-other-token', false]]) {
    const api = load({ 'node:https': network((o) => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
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

test('multiline descriptions remain valid and support URL belongs only in listing', () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  const metadata = json('plugins/trackly/listing/metadata.json');
  manifest.interface.longDescription += '\nA second paragraph.';
  const valid = state(); load().validateManifest(valid, manifest, metadata);
  assert.deepEqual(valid.errors, []);
  manifest.interface.longDescription += '\u0000';
  manifest.interface.supportURL = 'http://example.com';
  const invalid = state(); load().validateManifest(invalid, manifest, metadata);
  assert(invalid.errors.some(error => /longDescription.*unsupported/.test(error)));
  assert(invalid.errors.some(error => /supportURL.*not accepted/.test(error)));
  const listing = state(); load().validateMetadata(listing, metadata);
  assert.deepEqual(listing.errors, []);
});

test('screenshots decode PNG/JPEG and enforce 706 by 400..860 pixels', async () => {
  const { PNG } = require('pngjs');
  const jpeg = require('jpeg-js');
  for (const [width, height, type, valid] of [[706, 400, 'png', true], [706, 860, 'jpeg', true], [705, 400, 'png', false], [706, 399, 'jpeg', false], [706, 861, 'png', false], [706, 400, 'corrupt', false]]) {
    const raw = { width, height, data: Buffer.alloc(width * height * 4, 255) };
    const data = type === 'png' ? PNG.sync.write(raw) : type === 'jpeg' ? jpeg.encode(raw, 30).data : Buffer.from('not an encoded image');
    const target = path.join(root, 'plugins/trackly/assets/synthetic-screenshot.' + (type === 'jpeg' ? 'jpg' : 'png'));
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    manifest.interface.screenshots = ['./assets/' + path.basename(target)];
    manifest.interface.defaultPrompt = ['Find remote jobs'];
    const api = load({ 'node:fs': { ...fs,
      existsSync: file => file === target || fs.existsSync(file),
      statSync: file => file === target ? { size: data.length, isFile: () => true } : fs.statSync(file),
      readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
    } });
    const s = state(); await api.validateAssetsAndTree(s, manifest);
    assert.equal(s.errors.length === 0, valid, `${width}x${height} ${type}: ${s.errors.join('; ')}`);
  }
});

test('skill frontmatter uses YAML scalar strings and rejects malformed or missing fields', async () => {
  const cases = [
    ['name: synthetic\ndescription: "A quoted description"', true],
    ['name: synthetic\ndescription: >-\n  A folded description', true],
    ['name: [synthetic]\ndescription: valid', false],
    ['name: !unknown synthetic\ndescription: valid', false],
    ['name: synthetic\ndescription: {text: value}', false],
    ['name: "unterminated\ndescription: valid', false],
    ['name:\ndescription: valid', false],
    ['description: valid', false],
    ...['disable-model-invocation', 'disable_model_invocation'].flatMap(key => [[`name: synthetic\ndescription: valid\n${key}: false`, true], [`name: synthetic\ndescription: valid\n${key}: true`, false], [`name: synthetic\ndescription: valid\n${key}: \"false\"`, false]]),
  ];
  for (const [frontmatter, valid] of cases) {
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) {
      return String(file).endsWith('/SKILL.md') ? `---\n${frontmatter}\n---\nBody.\n` : fs.readFileSync(file, ...args);
    } } });
    const s = state(); await assert.doesNotReject(() => api.validateSkills(s));
    assert.equal(s.errors.length === 0, valid, `${frontmatter}: ${s.errors.join('; ')}`);
  }
});

test('authorization-server discovery requires the authorization code response type', async () => {
  for (const responseTypes of [undefined, 'code', ['token'], ['code']]) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: responseTypes, code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    assert.equal(s.errors.length === 0, Array.isArray(responseTypes) && responseTypes.includes('code'), s.errors.join('; '));
  }
});

test('review environment requires nested authentication and reviewer protocol fields', () => {
  for (const field of ['account', 'fixtures', 'submissionPolicy', 'identifierPolicy', 'authentication.mode', 'authentication.surface', 'authentication.credentialSource', 'authentication.requiredEvidence', 'authentication.additionalSetupRequired', 'authentication.thirdPartyIdentityProviderRequired', 'reviewerProtocol.startingState', 'reviewerProtocol.authenticationProof', 'reviewerProtocol.discoveryProbeProof', 'reviewerProtocol.safetyBoundary']) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json');
    const parts = field.split('.'); const parent = parts.length === 2 ? fixtures.reviewEnvironment[parts[0]] : fixtures.reviewEnvironment;
    delete parent[parts.at(-1)];
    const s = state(); load().validateSubmissionTests(s, fixtures);
    assert(s.errors.length > 0, `missing ${field} must fail`);
  }
});

test('manifest and listing legal URLs must agree', () => {
  for (const field of ['privacyPolicyURL', 'termsOfServiceURL']) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    const metadata = json('plugins/trackly/listing/metadata.json');
    metadata[field] = 'https://example.com/different';
    const s = state(); load().validateManifest(s, manifest, metadata);
    assert(s.errors.some(error => error.includes(field)), field);
  }
});

function pngChunk(type, payload) {
  const namedPayload = Buffer.concat([Buffer.from(type), payload]);
  let crc = 0xffffffff;
  for (const byte of namedPayload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, namedPayload, checksum]);
}

test('unsafe PNG headers and interlaced inflation stop before the image decoder allocates', async () => {
  const { PNG } = require('pngjs');
  const zlib = require('node:zlib');
  const encoded = PNG.sync.write({ width: 706, height: 400, data: Buffer.alloc(706 * 400 * 4, 255) });
  const oversizedHeader = Buffer.from(encoded.subarray(16, 29));
  oversizedHeader.writeUInt32BE(100000, 0); oversizedHeader.writeUInt32BE(100000, 4);
  const duplicateHeader = Buffer.concat([encoded.subarray(0, 33), pngChunk('IHDR', oversizedHeader), encoded.subarray(33)]);
  const interlacedHeader = Buffer.from(encoded.subarray(16, 29)); interlacedHeader[12] = 1;
  const bomb = Buffer.concat([encoded.subarray(0, 8), pngChunk('IHDR', interlacedHeader), pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(8 * 1024 * 1024 + 1))), pngChunk('IEND', Buffer.alloc(0))]);
  for (const data of [duplicateHeader, bomb]) {
    const target = path.join(root, 'plugins/trackly/assets/unsafe-synthetic.png');
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    manifest.interface.screenshots = ['./assets/unsafe-synthetic.png'];
    manifest.interface.defaultPrompt = ['Find remote jobs'];
    let decoderCalls = 0;
    const api = load({
      pngjs: { PNG: { sync: { read() { decoderCalls += 1; return { width: 706, height: 400 }; } } } },
      'node:fs': { ...fs,
        existsSync: file => file === target || fs.existsSync(file),
        statSync: file => file === target ? { size: data.length, isFile: () => true } : fs.statSync(file),
        readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
      },
    });
    const s = state(); await api.validateAssetsAndTree(s, manifest);
    assert(s.errors.some(error => /screenshot/.test(error)));
    assert.equal(decoderCalls, 0, 'unsafe PNG must be rejected before full decoder allocation');
  }
});

test('both prompt aliases must have valid types even when they normalize identically', () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.interface.defaultPrompt = ['42'];
  manifest.interface.default_prompt = [42];
  const s = state(); load().validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json'));
  assert(s.errors.length > 0);
});

test('author rejects unknown keys and optional manifest id must be a nonempty string', () => {
  for (const mutate of [m => { m.author.unrecognized = 'value'; }, m => { m.id = ''; }, m => { m.id = 123; }]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); mutate(manifest);
    const s = state(); load().validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json'));
    assert(s.errors.length > 0);
  }
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); manifest.id = 'trackly';
  const s = state(); load().validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json'));
  assert.deepEqual(s.errors, []);
});

test('OAuth authorization and token endpoints reject URL fragments', async () => {
  for (const field of ['authorization_endpoint', 'token_endpoint']) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token', [field]: 'https://example.com/endpoint#fragment' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    assert(s.errors.some(error => /fragment/.test(error)), field);
  }
});

test('nonempty screenshot count must match normalized prompt count', async () => {
  const { PNG } = require('pngjs');
  const data = PNG.sync.write({ width: 706, height: 400, data: Buffer.alloc(706 * 400 * 4, 255) });
  const target = path.join(root, 'plugins/trackly/assets/synthetic-count.png');
  const api = load({ 'node:fs': { ...fs,
    existsSync: file => file === target || fs.existsSync(file),
    statSync: file => file === target ? { size: data.length, isFile: () => true } : fs.statSync(file),
    readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
  } });
  for (const [screenshots, prompts, valid] of [[[], ['One'], true], [['./assets/synthetic-count.png'], 'One', true], [['./assets/synthetic-count.png'], ['One', 'Two'], false]]) {
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
    manifest.interface.screenshots = screenshots; manifest.interface.defaultPrompt = prompts;
    const s = state(); api.validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json')); await api.validateAssetsAndTree(s, manifest);
    assert.equal(s.errors.length === 0, valid, s.errors.join('; '));
  }
});

test('portal briefs match their identified fixture prompt including first user turns', () => {
  for (const id of ['search-recent-product', 'search-monitored-remote']) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json');
    const brief = fixtures.reviewEnvironment.portalCaseBriefs.find(item => item.id === id);
    brief.prompt = 'An unrelated reviewer request.';
    const invalid = state(); load().validateSubmissionTests(invalid, fixtures);
    assert(invalid.errors.length > 0, id);
    const fixture = fixtures.positive.find(item => item.id === id);
    const original = fixture.prompt || fixture.turns.find(turn => turn.role === 'user').content;
    brief.prompt = '  ' + original.replace(/ /g, '  ') + '  ';
    const valid = state(); load().validateSubmissionTests(valid, fixtures);
    assert.deepEqual(valid.errors, []);
  }
});

test('listing requires user manual submission wording and an account', () => {
  for (const boundary of ['The user never submits manually.', 'The agent reviews and submits every application manually.']) {
    const metadata = json('plugins/trackly/listing/metadata.json'); metadata.submissionBoundary = boundary;
    const s = state(); load().validateMetadata(s, metadata); assert(s.errors.length > 0);
  }
  for (const accountRequired of [undefined, false, 'true']) {
    const metadata = json('plugins/trackly/listing/metadata.json'); metadata.accountRequired = accountRequired;
    const s = state(); load().validateMetadata(s, metadata); assert(s.errors.length > 0);
  }
  const metadata = json('plugins/trackly/listing/metadata.json'); metadata.submissionBoundary = '  The user reviews and submits every application   manually.  ';
  const s = state(); load().validateMetadata(s, metadata); assert.deepEqual(s.errors, []);
});

test('static and live URLs require explicit absolute HTTPS syntax', async () => {
  for (const url of ['https:example.com', 'https:/example.com', 'https:///example.com']) {
    const metadata = json('plugins/trackly/listing/metadata.json'); metadata.supportURL = url;
    const s = state(); load().validateMetadata(s, metadata); assert(s.errors.length > 0, url);
    let contacted = false;
    const api = load({ 'node:https': network(() => { contacted = true; return { status: 200 }; }) });
    await assert.rejects(api.request(url)); assert.equal(contacted, false);
  }
});

test('manifest rejects nested TODO placeholders', () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.author.name = '[TODO: developer]'; manifest.interface.developerName = manifest.author.name;
  const s = state(); load().validateManifest(s, manifest, json('plugins/trackly/listing/metadata.json'));
  assert(s.errors.some(error => /TODO/.test(error)));
});

test('MCP configuration rejects unknown top-level fields', () => {
  const config = json('plugins/trackly/.mcp.json'); config.unrecognized = true;
  const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith('/.mcp.json') ? JSON.stringify(config) : fs.readFileSync(file, ...args); } } });
  const s = state(); api.validateMcpConfig(s, json('plugins/trackly/listing/metadata.json'));
  assert(s.errors.length > 0);
});

test('asset paths reject parent segments even when normalization stays within plugin', async () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json');
  manifest.interface.logo = './assets/../' + manifest.interface.logo.slice(2);
  const s = state(); await load().validateAssetsAndTree(s, manifest);
  assert(s.errors.length > 0);
});

test('existing skill companion YAML validates mappings, fields, policies, and icon paths', async () => {
  const valid = 'interface:\n  display_name: Synthetic\n  short_description: Test description\n';
  const cases = [
    [valid, true],
    ['interface: [unterminated', false],
    ['[]', false],
    ['interface: null', false],
    ['interface:\n  display_name: Synthetic\n', false],
    [valid + 'unknown: true\n', false],
    [valid + '  unknown: value\n', false],
    [valid + 'policy: []\n', false],
    [valid + 'policy:\n  allow_implicit_invocation: "true"\n', false],
    [valid + 'policy:\n  allow_implicit_invocation: yes\n', true],
    [valid + 'dependencies: []\n', false],
    [valid + 'dependencies:\n  unknown: []\n', false],
    [valid + '  icon_small: ./missing.png\n', false],
    [valid + '  icon_large: ../outside.png\n', false],
    ['interface:\n  display_name: yes\n  short_description: Test\n', false],
  ];
  for (const [source, expected] of cases) {
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) {
      return String(file).endsWith('/agents/openai.yaml') ? source : fs.readFileSync(file, ...args);
    } } });
    const s = state(); await assert.doesNotReject(() => api.validateSkills(s));
    assert.equal(s.errors.length === 0, expected, `${source}: ${s.errors.join('; ')}`);
  }
});

test('all fixture IDs must be nonempty strings including internal-only cases', () => {
  for (const id of [undefined, null, 42, '']) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json');
    fixtures.positive.find(item => item.id === 'resume-apply').id = id;
    const s = state(); load().validateSubmissionTests(s, fixtures);
    assert(s.errors.length > 0, String(id));
  }
});

test('public pages require complete HTTP 200 responses', async () => {
  for (const status of [200, 204, 206]) {
    const api = load({ 'node:https': network(() => ({ status })) });
    const s = state(); await api.checkPublicPage(s, 'https://example.com/page', 'page');
    assert.equal(s.errors.length === 0, status === 200, String(status));
  }
});

test('every authorization server URL is validated before selecting the first issuer', async () => {
  for (const second of [42, 'http://second.example.com', 'https://second.example.com?query', 'https://second.example.com#fragment', 'https://second.example.com']) {
    const selected = [];
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com', second] }) };
      if (o.path.includes('oauth-authorization-server')) {
        selected.push(o.hostname);
        return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      }
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    const valid = second === 'https://second.example.com';
    assert.equal(s.errors.length === 0, valid, String(second));
    assert.deepEqual(selected, valid ? ['example.com'] : []);
  }
});

test('branding fully decodes supported raster formats with square size and file bounds', async () => {
  const sharp = require('sharp');
  for (const [format, width, height, valid, corrupt, oversized] of [
    ['png', 48, 48, true], ['jpeg', 48, 48, true], ['webp', 48, 48, true],
    ['png', 48, 49, false], ['png', 47, 47, false], ['png', 4097, 4097, false],
    ['png', 48, 48, false, true], ['png', 48, 48, false, false, true],
  ]) {
    const data = corrupt ? Buffer.from('invalid image') : await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).toFormat(format).toBuffer();
    const target = path.join(root, `plugins/trackly/assets/synthetic-branding.${format}`);
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); manifest.interface.logo = './assets/' + path.basename(target);
    const api = load({ 'node:fs': { ...fs,
      existsSync: file => file === target || fs.existsSync(file),
      statSync: file => file === target ? { size: oversized ? 5 * 1024 * 1024 + 1 : data.length, isFile: () => true } : fs.statSync(file),
      readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
    } });
    const s = state(); await api.validateAssetsAndTree(s, manifest);
    assert.equal(s.errors.length === 0, valid, `${format} ${width}x${height} corrupt=${corrupt} oversized=${oversized}: ${s.errors.join('; ')}`);
  }
});

test('branding validates SVG XML, dimensions, and raster extension agreement', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const [name, data, valid] of [
    ['valid.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"></svg>'), true],
    ['pixels.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="48px"></svg>'), true],
    ['pixels-viewbox.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="48px" viewBox="0 0 48 48"></svg>'), true],
    ['malformed.svg', Buffer.from('<svg viewBox="0 0 48 48"><g></svg>'), false],
    ['rectangle.svg', Buffer.from('<svg viewBox="0 0 48 96"></svg>'), false],
    ['tiny.svg', Buffer.from('<svg viewBox="0 0 47 47"></svg>'), false],
    ['mismatch.webp', png, false],
  ]) {
    const target = path.join(root, 'plugins/trackly/assets/' + name);
    const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); manifest.interface.logo = './assets/' + name;
    const api = load({ 'node:fs': { ...fs,
      existsSync: file => file === target || fs.existsSync(file),
      statSync: file => file === target ? { size: data.length, isFile: () => true } : fs.statSync(file),
      readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
    } });
    const s = state(); await api.validateAssetsAndTree(s, manifest);
    assert.equal(s.errors.length === 0, valid, `${name}: ${s.errors.join('; ')}`);
  }
});

test('credential scan rejects standard npm token and password assignments', () => {
  for (const assignment of ['//registry.npmjs.org/:_authToken=synthetic-value', '_password=synthetic-value', 'NPM_ACCESS_TOKEN=synthetic-value']) {
    let read = false;
    const content = Buffer.from(assignment);
    const api = load({ 'node:fs': { ...fs, openSync: () => -123, closeSync: () => {}, readSync(fd, buffer) {
      if (read) return 0; read = true; content.copy(buffer); return content.length;
    } } });
    assert.equal(api.containsCredentialAssignment('synthetic'), true, assignment.split('=')[0]);
  }
});

test('optional OAuth scopes metadata must be an array of strings', async () => {
  for (const scopes of [undefined, ['jobs:read'], 'jobs:read', [42]]) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token', scopes_supported: scopes }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    assert.equal(s.errors.length === 0, scopes === undefined || (Array.isArray(scopes) && scopes.every(scope => typeof scope === 'string')), String(scopes));
  }
});

test('positive reviewer fixtures require nonempty string safety assertions', () => {
  for (const mustNot of [undefined, [], 'submit', [42], ['']]) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json');
    fixtures.positive[0].mustNot = mustNot;
    const s = state(); load().validateSubmissionTests(s, fixtures);
    assert(s.errors.length > 0, JSON.stringify(mustNot));
  }
});

test('protected-resource optional scopes metadata must be an array of strings', async () => {
  for (const scopes of [undefined, ['jobs:read'], 'jobs:read', [42]]) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'], scopes_supported: scopes }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token' }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false });
    assert.equal(s.errors.length === 0, scopes === undefined || (Array.isArray(scopes) && scopes.every(scope => typeof scope === 'string')), String(scopes));
  }
});

test('negative reviewer fixtures require nonempty string forbidden actions', () => {
  for (const forbidden of [[null], [''], [42]]) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json'); fixtures.negative[0].forbidden = forbidden;
    const s = state(); load().validateSubmissionTests(s, fixtures);
    assert(s.errors.length > 0, JSON.stringify(forbidden));
  }
});

test('positive expected actions and result shapes require nonempty string entries', () => {
  for (const field of ['expected', 'expectedResultShape']) {
    for (const value of [[42], ['']]) {
      const fixtures = json('plugins/trackly/listing/submission-tests.json'); fixtures.positive[0][field] = value;
      const s = state(); load().validateSubmissionTests(s, fixtures);
      assert(s.errors.length > 0, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('internal reviewer cases validate supplied prompts and conversation turns', () => {
  for (const mutate of [
    item => { item.prompt = 42; },
    item => { delete item.prompt; item.turns = [{ role: 'user' }]; },
    item => { item.turns = []; },
    item => { item.turns = 'invalid'; },
    item => { item.turns = [{ role: 'system', content: 'Synthetic prompt' }]; },
    item => { item.turns = [{ role: 'user', content: '', expected: [] }]; },
    item => { item.turns = [{ role: 'assistant', content: 'Synthetic answer', expected: [42] }]; },
  ]) {
    const fixtures = json('plugins/trackly/listing/submission-tests.json'); mutate(fixtures.positive.find(item => item.id === 'resume-apply'));
    const s = state(); load().validateSubmissionTests(s, fixtures); assert(s.errors.length > 0);
  }
  const fixtures = json('plugins/trackly/listing/submission-tests.json');
  fixtures.positive.find(item => item.id === 'resume-apply').turns = [{ role: 'assistant', content: 'Synthetic answer', expected: [] }];
  const s = state(); load().validateSubmissionTests(s, fixtures); assert.deepEqual(s.errors, []);
});

test('credential scan rejects Authorization headers and access token query parameters', () => {
  for (const assignment of ['Authorization: Bearer synthetic-value', '"Authorization": "Bearer synthetic-value"', 'https://example.com/path?access_token=synthetic-value']) {
    let read = false; const content = Buffer.from(assignment);
    const api = load({ 'node:fs': { ...fs, openSync: () => -123, closeSync: () => {}, readSync(fd, buffer) {
      if (read) return 0; read = true; content.copy(buffer); return content.length;
    } } });
    assert.equal(api.containsCredentialAssignment('synthetic'), true);
  }
});

test('MCP server rejects extra headers even without credential-shaped values', () => {
  const config = json('plugins/trackly/.mcp.json'); config.mcpServers.trackly.headers = { 'X-Synthetic': 'value' };
  const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith('/.mcp.json') ? JSON.stringify(config) : fs.readFileSync(file, ...args); } } });
  const s = state(); api.validateMcpConfig(s, json('plugins/trackly/listing/metadata.json')); assert(s.errors.length > 0);
});

test('skill frontmatter accepts normalized CRLF but rejects BOM and leading blanks', async () => {
  for (const source of ['---\r\nname: synthetic\r\ndescription: valid\r\n---\r\nBody', '\ufeff---\nname: synthetic\ndescription: valid\n---\nBody', '\n---\nname: synthetic\ndescription: valid\n---\nBody']) {
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith('/SKILL.md') ? source : fs.readFileSync(file, ...args); } } });
    const s = state(); await api.validateSkills(s); assert.equal(s.errors.length === 0, source.startsWith('---\r\n'), s.errors.join('; '));
  }
});

test('authorization discovery requires supported client registration', async () => {
  for (const [registration, valid] of [[{}, false], [{ registration_endpoint: 'http://example.com/register' }, false], [{ registration_endpoint: 'https://example.com/register' }, true], [{ client_id_metadata_document_supported: true }, true]]) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token', ...registration }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false }); assert.equal(s.errors.length === 0, valid, s.errors.join('; '));
  }
});

test('listing retains the reviewed website and audience', () => {
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); const metadata = json('plugins/trackly/listing/metadata.json');
  manifest.interface.websiteURL = 'https://usetrackly.app/other';
  const website = state(); load().validateManifest(website, manifest, metadata); assert(website.errors.length > 0);
  metadata.audience = 'All users';
  const audience = state(); load().validateMetadata(audience, metadata); assert(audience.errors.length > 0);
});

test('advertised OAuth grants must support authorization code while omission remains valid', async () => {
  for (const grants of [undefined, ['authorization_code'], ['client_credentials']]) {
    const api = load({ 'node:https': network(o => {
      if (o.method === 'POST') return { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://example.com/resource"' } };
      if (o.path === '/resource') return { body: JSON.stringify({ resource: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', authorization_servers: ['https://example.com'] }) };
      if (o.path.includes('oauth-authorization-server')) return { body: JSON.stringify({ issuer: 'https://example.com', client_id_metadata_document_supported: true, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], authorization_endpoint: 'https://example.com/auth', token_endpoint: 'https://example.com/token', grant_types_supported: grants }) };
      return { status: 404 };
    }) });
    const s = state(); await api.runLive(s, { checkPublicPages: false }); assert.equal(s.errors.length === 0, grants === undefined || grants.includes('authorization_code'), s.errors.join('; '));
  }
});

test('skill dependency tool descriptors require the reviewed MCP structure', async () => {
  const descriptor = { type: 'mcp', value: 'trackly', description: 'Synthetic MCP dependency', transport: 'streamable_http', url: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp' };
  for (const [tools, valid] of [[undefined, true], [[descriptor], true], ['invalid', false], [[null], false], [[{}], false], [[{ ...descriptor, type: 'other' }], false], [[{ ...descriptor, value: '' }], false], [[{ ...descriptor, description: 42 }], false], [[{ ...descriptor, transport: 'stdio' }], false], [[{ ...descriptor, url: 'http://example.com' }], false]]) {
    const source = JSON.stringify({ interface: { display_name: 'Synthetic', short_description: 'Synthetic description' }, dependencies: tools === undefined ? {} : { tools } });
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith('/agents/openai.yaml') ? source : fs.readFileSync(file, ...args); } } });
    const s = state(); await api.validateSkills(s); assert.equal(s.errors.length === 0, valid, `${JSON.stringify(tools)}: ${s.errors.join('; ')}`);
  }
});

test('skill dependency identity and listing support URL retain reviewed destinations', async () => {
  for (const override of [{ value: 'other' }, { url: 'https://example.com/mcp' }]) {
    const source = JSON.stringify({ interface: { display_name: 'Synthetic', short_description: 'Synthetic description' }, dependencies: { tools: [{ type: 'mcp', value: 'trackly', description: 'Synthetic dependency', transport: 'streamable_http', url: 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', ...override }] } });
    const api = load({ 'node:fs': { ...fs, readFileSync(file, ...args) { return String(file).endsWith('/agents/openai.yaml') ? source : fs.readFileSync(file, ...args); } } });
    const s = state(); await api.validateSkills(s); assert(s.errors.length > 0);
  }
  const metadata = json('plugins/trackly/listing/metadata.json'); metadata.supportURL = 'https://example.com/support';
  const s = state(); load().validateMetadata(s, metadata); assert(s.errors.length > 0);
});

test('branding SVG rejects rectangular intrinsic dimensions despite square viewBox', async () => {
  const target = path.join(root, 'plugins/trackly/assets/synthetic-intrinsic.svg');
  const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48" viewBox="0 0 48 48"></svg>');
  const manifest = json('plugins/trackly/.codex-plugin/plugin.json'); manifest.interface.logo = './assets/' + path.basename(target);
  const api = load({ 'node:fs': { ...fs,
    existsSync: file => file === target || fs.existsSync(file),
    statSync: file => file === target ? { size: data.length, isFile: () => true } : fs.statSync(file),
    readFileSync: (file, ...args) => file === target ? data : fs.readFileSync(file, ...args),
  } });
  const s = state(); await api.validateAssetsAndTree(s, manifest); assert(s.errors.length > 0);
});

test('skill icons must decode as images while small valid icons are supported', async () => {
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const [name, data, valid] of [['README.md', Buffer.from('Not an image'), false], ['corrupt.png', Buffer.from('corrupt image'), false], ['small.png', png, true]]) {
    const source = JSON.stringify({ interface: { display_name: 'Synthetic', short_description: 'Synthetic description', icon_small: './assets/' + name } });
    const isIcon = file => String(file).includes('/skills/') && String(file).endsWith('/assets/' + name);
    const api = load({ 'node:fs': { ...fs,
      existsSync: file => isIcon(file) || fs.existsSync(file),
      statSync: file => isIcon(file) ? { size: data.length, isFile: () => true } : fs.statSync(file),
      readFileSync(file, ...args) { return String(file).endsWith('/agents/openai.yaml') ? source : isIcon(file) ? data : fs.readFileSync(file, ...args); },
    } });
    const s = state(); await api.validateSkills(s); assert.equal(s.errors.length === 0, valid, `${name}: ${s.errors.join('; ')}`);
  }
});
