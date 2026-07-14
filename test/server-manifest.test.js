'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const manifest = require('../server.json');
const pkg = require('../package.json');

test('server manifest stays aligned with the npm package and MCP launch contract', () => {
  assert.equal(manifest.title, 'Trackly CLI');
  assert.equal(manifest.websiteUrl, 'https://usetrackly.app/cli');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.packages[0].identifier, pkg.name);
  assert.equal(manifest.packages[0].version, pkg.version);
  assert.deepEqual(manifest.packages[0].packageArguments, [
    {
      type: 'positional',
      value: 'mcp',
    },
  ]);
});

test('package files include the registry manifest', () => {
  assert.ok(pkg.files.includes('server.json'));
  assert.ok(!pkg.files.includes('scripts/verify-hosted-contract.js'));
});
