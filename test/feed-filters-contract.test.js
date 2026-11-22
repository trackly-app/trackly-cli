'use strict';

// Conformance of the CLI and the local MCP to the shared feed-filter contract (contracts/feed-filters/, vendored
// from close-ai by contract-sync.json). Every fixture selection goes through the real lib/jobs-feed-query.js
// builder, and the result is compared after form-decoding, the way Express reads it. A coverage check fails when
// a registry param has no CLI flag or MCP argument.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('../mcp/server');
const { FEED_FILTER_PARAMS, buildFeedFilterQuery, cliFlag, mcpArg, selectionFromFlags } = require('../lib/jobs-feed-query');
const cli = require('../bin/trackly');

const ROOT = path.join(__dirname, '..');
const { cases } = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/feed-filters/fixtures.json'), 'utf8'));

const decode = (queryString) => [...new URLSearchParams(queryString)].sort(([a], [b]) => a.localeCompare(b));
const sortedPairs = (pairs) => [...pairs].sort(([a], [b]) => a.localeCompare(b));

// Fixtures the published local MCP schema cannot take as written, each with the written reason; the test proves
// the published schema really rejects it, so an entry cannot outlive its cause.
const MCP_UNREPRESENTABLE = {
  'profile-lists': { arg: 'locationFilter', args: { locationFilter: ['us', 'canada'] }, reason: "the published locationFilter list excludes 'us' because the backend drops the other tags" },
};

test('every fixture selection builds the fixture query through the real builder', () => {
  assert.ok(cases.length > 0);
  for (const { name, selection, query } of cases) {
    const built = decode(buildFeedFilterQuery(selection).toString());
    assert.deepEqual(built, sortedPairs(query), `${name}: ${JSON.stringify(selection)}`);
  }
});

test('every registry param is covered by a fixture', () => {
  const used = new Set(cases.flatMap(({ selection }) => Object.keys(selection)));
  for (const { param } of FEED_FILTER_PARAMS) assert.ok(used.has(param), `no fixture selects ${param}`);
});

test('the builder fails closed on a value outside the registry domain', () => {
  assert.throws(() => buildFeedFilterQuery({ seniority: ['wizard'] }), /Invalid seniority value "wizard"/);
  assert.throws(() => buildFeedFilterQuery({ minMatchScore: 101 }), /minMatchScore/);
  assert.throws(() => buildFeedFilterQuery({ skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] }), /at most 10/);
  assert.throws(() => buildFeedFilterQuery({ skills: ['bad|char'] }), /skills/);
  assert.throws(() => buildFeedFilterQuery({ usStates: [] }), /at least one value/);
});

// A command line carrying each fixture's selection, the way a user would type it.
function flagsFor(selection) {
  const args = {};
  for (const entry of FEED_FILTER_PARAMS) {
    const value = selection[entry.param];
    if (value === undefined || value === false) continue; // a flag that is off is not typed
    args[cliFlag(entry)] = entry.values.kind === 'bool' ? true : Array.isArray(value) ? value.join(',') : String(value);
  }
  return args;
}

test('the CLI maps exactly the registry params, and each fixture selection round-trips through its flags', () => {
  const flags = FEED_FILTER_PARAMS.map(cliFlag);
  assert.equal(new Set(flags).size, flags.length, 'two params share a CLI flag');
  for (const flag of flags) {
    assert.ok(cli.COMMAND_FLAGS.jobs.includes(flag), `--${flag} is not accepted by trackly jobs`);
  }
  const help = fs.readFileSync(path.join(ROOT, 'bin/trackly'), 'utf8');
  for (const flag of flags) assert.ok(help.includes(`--${flag}`), `--${flag} is not documented in the help text`);
  const seen = new Set();
  for (const { name, selection, query } of cases) {
    const fromFlags = selectionFromFlags(flagsFor(selection));
    for (const key of Object.keys(fromFlags)) seen.add(key);
    assert.deepEqual(decode(buildFeedFilterQuery(fromFlags).toString()), sortedPairs(query), name);
  }
  for (const { param } of FEED_FILTER_PARAMS) assert.ok(seen.has(param), `${param} never reached through a flag`);
});

test('an explicit 0 for postedWithinDays and salaryFloorUsd is sent: it turns off the saved value', () => {
  assert.deepEqual(decode(buildFeedFilterQuery({ postedWithinDays: 0, salaryFloorUsd: 0 }).toString()), [['postedWithinDays', '0'], ['salaryFloorUsd', '0']]);
  assert.throws(() => buildFeedFilterQuery({ postedWithinDays: 2 }), /postedWithinDays/);
  assert.throws(() => buildFeedFilterQuery({ minMatchScore: -1 }), /minMatchScore/);
});

test('CLI flags reject a missing or out-of-domain value before building a query', () => {
  assert.throws(() => selectionFromFlags({ seniority: 'wizard' }), /Invalid --seniority value "wizard"/);
  assert.throws(() => selectionFromFlags({ 'min-match-score': 'high' }), /Invalid --min-match-score value "high"/);
  assert.throws(() => selectionFromFlags({ sector: true }), /--sector requires a value/);
  // Integers are canonical decimals on the wire (no sign, no leading zeros): flag text is not normalised into one.
  for (const bad of ['030', '+5', '-5']) assert.throws(() => selectionFromFlags({ 'min-match-score': bad }), /Invalid --min-match-score value/, bad);
  assert.deepEqual(selectionFromFlags({ 'min-match-score': '0' }), { minMatchScore: 0 });
  assert.throws(() => selectionFromFlags({ 'favorite-companies-only': 'yes' }), /takes no value/);
});

async function withMcpClient(t) {
  const requests = [];
  const httpServer = http.createServer((req, res) => {
    requests.push(new URL(req.url, 'http://localhost'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, jobs: [], total: 0, hasMore: false }));
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const previous = { apiKey: process.env.TRACKLY_API_KEY, baseUrl: process.env.TRACKLY_BASE_URL };
  process.env.TRACKLY_API_KEY = 'trk_feed_filters_fixture';
  process.env.TRACKLY_BASE_URL = `http://127.0.0.1:${httpServer.address().port}`;
  const server = createServer();
  const client = new Client({ name: 'feed-filters-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    await new Promise((resolve) => httpServer.close(resolve));
    for (const [key, value] of [['TRACKLY_API_KEY', previous.apiKey], ['TRACKLY_BASE_URL', previous.baseUrl]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, requests };
}

test('the local MCP offers every registry param under its published or contract name', async (t) => {
  const { client } = await withMcpClient(t);
  const tool = (await client.listTools()).tools.find(({ name }) => name === 'trackly_search_jobs');
  for (const entry of FEED_FILTER_PARAMS) {
    assert.ok(mcpArg(entry) in tool.inputSchema.properties, `trackly_search_jobs has no argument ${mcpArg(entry)} for ${entry.param}`);
  }
  assert.doesNotMatch(tool.description, /Never invent industry/);
});

test('each fixture selection reaches the wire through the local trackly_search_jobs tool', async (t) => {
  const { client, requests } = await withMcpClient(t);
  for (const { name, selection, query } of cases) {
    const args = Object.fromEntries(Object.entries(selection).map(([param, value]) => {
      const entry = FEED_FILTER_PARAMS.find((e) => e.param === param);
      return [mcpArg(entry), value];
    }));
    const unrepresentable = MCP_UNREPRESENTABLE[name];
    if (unrepresentable) {
      const result = await client.callTool({ name: 'trackly_search_jobs', arguments: args });
      assert.equal(result.isError, true, `${name}: ${unrepresentable.reason}`);
      continue;
    }
    // The published `function` takes one value; several go through `jobFunctions`.
    if (Array.isArray(args.function)) { args.jobFunctions = args.function; delete args.function; }
    const before = requests.length;
    const result = await client.callTool({ name: 'trackly_search_jobs', arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
    assert.equal(requests.length, before + 1, name);
    const wire = sortedPairs([...requests[before].searchParams]
      // The tool always pages (limit), asks for every function when none is given (the all-roles short-circuit), and
      // pins the discovery view (status=new) for a sponsorship filter, which the backend honors only there.
      .filter(([key]) => key !== 'limit' && key !== 'status'
        && !(key === 'jobFunction' && selection.jobFunction === undefined)));
    assert.deepEqual(wire, sortedPairs(query), name);
  }
});

// What a published argument accepts, as a comparable value: the list items (or the scalar) it allows, or the bounds
// of a number, or the length cap of a string. For a union the list form decides, because that is the one the
// registry's csv encoding describes.
function acceptedByArg(schema) {
  if (schema.anyOf) {
    const list = schema.anyOf.find((branch) => branch.type === 'array');
    if (list) return acceptedByArg(list);
    const parts = schema.anyOf.map(acceptedByArg);
    if (parts.every((p) => p.values)) return { values: parts.flatMap((p) => p.values).sort() };
    throw new Error(`cannot compare a union: ${JSON.stringify(schema)}`);
  }
  if (schema.type === 'array') return acceptedByArg(schema.items);
  if (schema.enum) return { values: [...schema.enum].sort() };
  if (schema.const !== undefined) return { values: [schema.const] };
  if (schema.type === 'integer' || schema.type === 'number') return { min: schema.minimum, max: schema.maximum };
  if (schema.type === 'boolean') return { bool: true };
  if (schema.type === 'string') return { maxLength: schema.maxLength };
  throw new Error(`cannot compare ${JSON.stringify(schema)}`);
}

function acceptedByRegistry(entry) {
  const d = entry.values;
  if (d.kind === 'enum' || d.kind === 'intList') return { values: [...d.values].sort() };
  if (d.kind === 'int') return { min: d.min, max: d.max };
  if (d.kind === 'bool') return { bool: true };
  return { maxLength: d.maxLength };
}

// The published arguments that accept something other than their registry entry: exactly this set.
const EXPECTED_EXCEPTIONS = ['keywords', 'locationFilter', 'postedWithinDays', 'salaryFloorUsd', 'sponsorship'];

test('every published argument accepts what its registry entry accepts, except the named exceptions', async (t) => {
  const { FEED_ARG_EXCEPTIONS } = require('../mcp/server');
  assert.deepEqual(Object.keys(FEED_ARG_EXCEPTIONS).sort(), EXPECTED_EXCEPTIONS);
  for (const [arg, reason] of Object.entries(FEED_ARG_EXCEPTIONS)) assert.ok(reason.length > 20, `${arg}: the exception needs its reason`);
  const { client } = await withMcpClient(t);
  const tool = (await client.listTools()).tools.find(({ name }) => name === 'trackly_search_jobs');
  for (const entry of FEED_FILTER_PARAMS) {
    const arg = mcpArg(entry);
    const published = acceptedByArg(tool.inputSchema.properties[arg]);
    const registry = acceptedByRegistry(entry);
    if (arg in FEED_ARG_EXCEPTIONS) assert.notDeepEqual(published, registry, `${arg} is listed as an exception but matches the registry`);
    else assert.deepEqual(published, registry, `${arg} differs from registry ${entry.param}`);
  }
});
