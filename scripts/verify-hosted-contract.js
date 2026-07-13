#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cliRoot = path.join(__dirname, '..');
const backendRoot = process.env.TRACKLY_BACKEND_DIR || path.resolve(cliRoot, '..', 'backend');
const localContractPath = path.join(cliRoot, 'contracts', 'trackly-apply-tools.json');
const hostedContractPath = path.join(backendRoot, 'contracts', 'trackly-apply-tools.json');

if (!fs.existsSync(hostedContractPath)) {
  throw new Error(`Hosted contract not found at ${hostedContractPath}. Set TRACKLY_BACKEND_DIR to the close-ai checkout.`);
}

const local = JSON.parse(fs.readFileSync(localContractPath, 'utf8'));
const hosted = JSON.parse(fs.readFileSync(hostedContractPath, 'utf8'));
assert.deepEqual(hosted, local, 'Hosted and local Trackly Apply MCP contracts drifted');
console.log(`Trackly Apply MCP contracts match at ${local.contractVersion}.`);
