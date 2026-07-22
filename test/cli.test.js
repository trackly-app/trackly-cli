'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('limited-rollout OAuth errors explain invitations and the access page', () => {
  const error = cli.loginAccessError('invitation_invalid');

  assert.equal(error.code, 'INVITATION_INVALID');
  assert.match(error.message, /limited rollout/i);
  assert.match(error.message, /private invite/i);
  assert.match(error.message, /https:\/\/usetrackly\.app\/early-access/);
  assert.ok(cli.loginAccessError('invitation_redeemed'));
  assert.ok(cli.loginAccessError('signup_intent_expired'));
  assert.ok(cli.loginAccessError('access_batch_full'));
  assert.equal(cli.loginAccessError('auth_failed'), null);
});

test('nearestFlag suggests the closest valid flag within edit distance 2', () => {
  const allowed = new Set(['region', 'function', 'status', 'limit']);
  assert.equal(cli.nearestFlag('regoin', allowed), 'region');
  assert.equal(cli.nearestFlag('functon', allowed), 'function');
  assert.equal(cli.nearestFlag('zzzzzzzzz', allowed), null, 'no suggestion when nothing is close');
});

test('COMMAND_FLAGS keeps deprecated jobs flags so they reach the migration message', () => {
  assert.ok(cli.COMMAND_FLAGS.jobs.includes('location'));
  assert.ok(cli.COMMAND_FLAGS.jobs.includes('modality'));
  assert.ok(cli.COMMAND_FLAGS.jobs.includes('region'));
  assert.ok(cli.COMMAND_FLAGS.jobs.includes('work-arrangement'));
  assert.deepEqual(cli.COMMAND_FLAGS.job, [], 'job detail accepts no filter flags');
});

test('trackly --version prints the package version', () => {
  const result = spawnSync(process.execPath, [BIN_PATH, '--version'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('human maintenance output retains code, statuses, request ID, and resume guidance', () => {
  const rendered = cli.formatMaintenanceForHuman({
    message: 'Trackly is migrating. Retry in about 5 minutes.',
    code: 'maintenance_mode',
    status: 503,
    serviceStatus: 'maintenance',
    requestId: 'req-human-cli',
    guidance: 'Wait, refetch state, and resume the existing run without clicking Submit.',
  });

  assert.match(rendered, /Trackly is migrating/);
  assert.match(rendered, /Code: maintenance_mode/);
  assert.match(rendered, /HTTP status: 503/);
  assert.match(rendered, /service status: maintenance/);
  assert.match(rendered, /Request ID: req-human-cli/);
  assert.match(rendered, /resume the existing run without clicking Submit/);

  const source = fs.readFileSync(BIN_PATH, 'utf8');
  assert.match(source, /report\.resume\?\.maintenance/);
  assert.match(source, /formatMaintenanceForHuman\(report\.resume\.maintenance\)/);
  assert.match(source, /formatMaintenanceForHuman\(report\.apiError\)/);
});
