'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('node:child_process');

const cli = require('../bin/trackly');
const pkg = require('../package.json');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'trackly');

test('parseArgs supports flags before the command', () => {
  const parsed = cli.parseArgs(['--json', 'job', '1234']);

  assert.equal(parsed.command, 'job');
  assert.deepEqual(parsed._, ['1234']);
  assert.equal(parsed.json, true);
});

test('parseArgs keeps command sub-arguments intact', () => {
  const parsed = cli.parseArgs(['companies', 'search', 'fintech', '--limit', '5']);

  assert.equal(parsed.command, 'companies');
  assert.deepEqual(parsed._, ['search', 'fintech']);
  assert.equal(parsed.limit, '5');
});

test('parseArgs marks missing value flags as null', () => {
  const parsed = cli.parseArgs(['config', '--api-key']);

  assert.equal(parsed.command, 'config');
  assert.equal(parsed['api-key'], null);
});

test('parseJobId validates positive integer identifiers', () => {
  assert.equal(cli.parseJobId('123'), 123);
  assert.equal(cli.parseJobId('00123'), 123);
  assert.equal(cli.parseJobId('abc'), null);
  assert.equal(cli.parseJobId('-1'), null);
});

test('normalizeBaseUrlValue trims trailing slashes', () => {
  assert.equal(cli.normalizeBaseUrlValue('https://closeai.mba/'), 'https://closeai.mba');
});

test('trackly --version prints the package version', () => {
  const result = spawnSync(process.execPath, [BIN_PATH, '--version'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});
