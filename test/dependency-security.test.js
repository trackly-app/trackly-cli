'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  validateAuditReport,
} = require('../scripts/verify-audit-exceptions');

const POLICY_PATH = path.join(__dirname, '..', 'security', 'audit-exceptions.json');
const PACKAGE_LOCK_PATH = path.join(__dirname, '..', 'package-lock.json');
const SHRINKWRAP_PATH = path.join(__dirname, '..', 'npm-shrinkwrap.json');

function policy() {
  return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
}

function cleanReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  };
}

test('published shrinkwrap exactly matches the repository dependency lock', () => {
  assert.deepEqual(
    JSON.parse(fs.readFileSync(SHRINKWRAP_PATH, 'utf8')),
    JSON.parse(fs.readFileSync(PACKAGE_LOCK_PATH, 'utf8')),
  );
});

test('audit policy permits no temporary exceptions', () => {
  assert.deepEqual(policy(), {
    schemaVersion: 1,
    exceptions: [],
  });
});

test('audit gate accepts only a clean report', () => {
  assert.deepEqual(validateAuditReport(cleanReport(), policy()), {
    allowedAdvisories: [],
    propagatedVulnerabilities: [],
  });

  const report = cleanReport();
  report.vulnerabilities.example = {
    name: 'example',
    severity: 'low',
    isDirect: true,
    via: [],
    effects: [],
    range: '<1.0.1',
    nodes: ['node_modules/example'],
  };
  report.metadata.vulnerabilities.low = 1;
  report.metadata.vulnerabilities.total = 1;
  assert.throws(
    () => validateAuditReport(report, policy()),
    /permits no audit exceptions/i,
  );
});

test('audit gate reports registry failures without misclassifying the schema version', () => {
  assert.throws(
    () => validateAuditReport({
      message: 'request to the npm audit endpoint failed',
      error: { summary: '', detail: '' },
    }, policy()),
    /npm audit did not return an advisory report: request to the npm audit endpoint failed/i,
  );
});

test('audit command executes the npm lifecycle CLI path without shell parsing', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-audit-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const npmPath = path.join(fixture, 'npm fixture & cli.cjs');
  const receipt = path.join(fixture, 'argv.json');
  fs.writeFileSync(npmPath, `
    require('node:fs').writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(process.argv.slice(2)));
    process.stdout.write(${JSON.stringify(JSON.stringify(cleanReport()))});
  `);
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'verify-audit-exceptions.js'),
  ], {
    env: { ...process.env, npm_execpath: npmPath },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt, 'utf8')), [
    'audit', '--json', '--audit-level=moderate',
  ]);
  assert.match(result.stdout, /npm audit is clean/);
});

test('audit command can invoke the Windows npm shim outside an npm lifecycle', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-audit-shim-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture, 'npm.cmd'), `@echo off\r\necho ${JSON.stringify(cleanReport())}\r\n`);
  const env = { ...process.env, npm_execpath: '' };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${fixture}${path.delimiter}${env[pathKey] || ''}`;
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'verify-audit-exceptions.js'),
  ], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm audit is clean/);
});
