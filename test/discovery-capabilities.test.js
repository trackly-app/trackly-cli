'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseDiscoveryCapabilities } = require('../mcp/discovery-capabilities');
const disabled = require('../mcp/discovery-capabilities-v1.json');

function ready() {
  const proof = structuredClone(disabled);
  proof.discovery.available = true;
  proof.discovery.readiness = 'ready';
  return proof;
}

test('reviewed contract fixtures retain their immutable source bytes', () => {
  for (const [file, digest] of [
    ['mcp/discovery-capabilities-v1.json', '470c94c23731acdeae8f2d94ff62fe0eb26cc243d316f6b369aa6619a70b0db5'],
    ['test/fixtures/discovery/capabilities-v1.schema.json', '6624be01defadf9854676ce9f1951ad08e45e13922a59cedb0ecaa236dfcd145'],
  ]) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});

test('disabled by default and does not inspect a capability source', () => {
  const source = new Proxy({}, { get() { throw new Error('source inspected'); } });
  assert.equal(parseDiscoveryCapabilities(source), null);
  for (const enabled of [false, undefined, null, 1, 'true']) {
    assert.equal(parseDiscoveryCapabilities(source, { enabled }), null);
  }
});

test('missing, unavailable, unsupported and malformed proof stays unavailable', () => {
  const variants = [undefined, null, false, '', {}, { success: true }, disabled];
  for (const change of [
    proof => { proof.success = false; },
    proof => { proof.discovery.version = 0; },
    proof => { proof.discovery.version = 2; },
    proof => { proof.discovery.version = '1'; },
    proof => { proof.discovery.available = false; },
    proof => { proof.discovery.available = 'true'; },
    proof => { proof.discovery.readiness = 'disabled'; },
    proof => { proof.discovery.readiness = 'unavailable'; },
    proof => { delete proof.discovery.keywords; },
    proof => { proof.discovery.keywords.semanticExpansion = true; },
    proof => { proof.discovery.facets.industries.ids.push('invented'); },
    proof => { proof.discovery.facets.roleSpecializations.supported = true; },
    proof => { proof.extra = true; },
  ]) {
    const proof = ready();
    change(proof);
    variants.push(proof);
  }
  for (const proof of variants) {
    assert.equal(parseDiscoveryCapabilities(proof, { enabled: true }), null);
  }
});

test('synthetic ready proof parses exact semantics without production authority', () => {
  const proof = ready();
  const result = parseDiscoveryCapabilities(proof, { enabled: true });
  assert.equal(result.version, 1);
  assert.equal(result.readiness, 'ready');
  assert.deepEqual(result.keywords.fields, ['title', 'company', 'description', 'skills']);
  assert.equal(result.keywords.parameter, 'search');
  assert.equal(result.keywords.performance, 'unvalidated_on_azure; readiness_is_not_latency_proof');
  assert.equal(result.facets.industries.ids.length, 32);
  assert.equal(result.facets.industries.unknown, 'include');
  assert.equal(result.facets.roleSpecializations.supported, false);
  assert.equal(result.facets.subindustries.supported, false);
  result.facets.industries.ids.push('mutated');
  assert.equal(proof.discovery.facets.industries.ids.length, 32);
  assert.equal(parseDiscoveryCapabilities(ready(), { enabled: true }).facets.industries.ids.length, 32);
});

test('JSON object member ordering does not change capability validation', () => {
  const proof = ready();
  const reordered = { discovery: proof.discovery, success: true };
  assert.notEqual(parseDiscoveryCapabilities(reordered, { enabled: true }), null);
});

test('parser import and disabled evaluation perform no capability requests', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(id, ...rest) {
      if (/^(?:node:)?(?:https?|net|tls)$/.test(id) || id.includes('client') || id.endsWith('.json')) {
        throw new Error('unexpected transport import');
      }
      return originalLoad.call(this, id, ...rest);
    };
    global.fetch = () => { throw new Error('unexpected fetch'); };
    const { parseDiscoveryCapabilities } = require('./mcp/discovery-capabilities');
    if (parseDiscoveryCapabilities({}) !== null) process.exit(1);
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});
