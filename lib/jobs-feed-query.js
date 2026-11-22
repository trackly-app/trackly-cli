'use strict';

// The one builder of the job-feed filter query, shared by `trackly jobs` and the local trackly_search_jobs
// tool. The filters, their value domains and their wire encoding come from the vendored registry
// (contracts/feed-filters/params.json, generated in close-ai and synced by contract-sync.json), so a filter
// added there is one entry to map here and test/feed-filters-contract.test.js names it. The backend stays
// the validator and fails closed with HTTP 400; domains are checked here only so a bad value fails before
// the request.

const { params: FEED_FILTER_PARAMS } = require('../contracts/feed-filters/params.json');

// A published value that means "no filter": accepted as input, never sent.
const NO_FILTER_VALUES = Object.freeze({ sponsorship: 'all' });

// The server reads an explicit 0 on these two as "no window / no floor", overriding the saved value (resolveSavedFallbackFilters),
// and the local MCP has published it since the argument existed, so 0 is accepted next to the registry's own domain.
const ZERO_DISABLES_SAVED = new Set(['postedWithinDays', 'salaryFloorUsd']);

// CLI flags published before the registry keep their names; every other param is its kebab-case wire name.
const CLI_FLAG_OVERRIDES = Object.freeze({
  jobFunction: 'function',
  locationFilter: 'region',
  jobModality: 'job-type',
  search: 'keywords',
  workArrangements: 'work-arrangement',
});

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const cliFlag = (entry) => CLI_FLAG_OVERRIDES[entry.param] ?? kebab(entry.param);
// MCP arguments published before the registry keep their names (the registry's mcpArg); new ones use the wire name.
const mcpArg = (entry) => entry.mcpArg ?? entry.param;
// The value list of an enum or integer-list registry entry.
function registryValues(param) {
  const entry = FEED_FILTER_PARAMS.find((e) => e.param === param);
  if (!entry || !Array.isArray(entry.values.values)) throw new Error(`jobs-feed-query: registry param ${param} has no value list`);
  return [...entry.values.values];
}

const isBool = (entry) => entry.values.kind === 'bool';

const FIELD_PREFIX = /^(title|company|desc):/i;

// Splits on whitespace outside quotes; "(" and ")" outside quotes are tokens of their own (TracklyWeb search-operators.ts).
function tokenize(text) {
  const tokens = [];
  let current = '';
  let inQuote = false;
  const flush = () => { if (current) tokens.push(current); current = ''; };
  for (const char of text) {
    if (char === '"') { inQuote = !inQuote; current += char; }
    else if (inQuote) current += char;
    else if (/\s/.test(char)) flush();
    else if (char === '(' || char === ')') {
      if (char === '(' && current === '-') { tokens.push('-('); current = ''; } else { flush(); tokens.push(char); }
    } else current += char;
  }
  flush();
  return tokens;
}

// Whether search-box text needs the keyword grammar (q) rather than the plain search: a quote, a leading minus, OR,
// brackets or a field prefix, or any text searched in the description. Same rule as TracklyWeb's usesKeywordGrammar.
function usesKeywordGrammar(text, searchInDescription = false) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (searchInDescription) return true;
  return tokenize(trimmed).some((t) => t === 'OR' || t === '(' || t === '-(' || t.startsWith(')')
    || (t.startsWith('-') && t.length > 1) || t.includes('"') || FIELD_PREFIX.test(t));
}

// The registry's `normalize: "skill"` rule: trim, collapse whitespace runs, lowercase.
const normalizeItem = (domain, value) => (domain.normalize === 'skill'
  ? String(value).trim().replace(/\s+/g, ' ').toLowerCase()
  : String(value).trim());

// A list's items: trimmed, normalised, blanks and repeats dropped, as the server does.
const listItems = (entry, value) => [...new Set((Array.isArray(value) ? value : [value])
  .map((v) => normalizeItem(entry.values, v)).filter((v) => v !== ''))];

// Why `value` is outside the entry's domain, or null.
function domainError(entry, value) {
  const d = entry.values;
  if (value === 0 && ZERO_DISABLES_SAVED.has(entry.param)) return null;
  switch (d.kind) {
    case 'enum':
    case 'intList': return d.values.includes(value) ? null : `Use: ${d.values.join(', ')}.`;
    case 'int': return Number.isInteger(value) && value >= d.min && value <= d.max ? null : `Use a whole number from ${d.min} to ${d.max}.`;
    case 'bool': return typeof value === 'boolean' ? null : 'Use it as a flag with no value.';
    case 'string': {
      const text = normalizeItem(d, value);
      if (text === '') return 'Use a non-empty value.';
      if (d.maxLength !== undefined && text.length > d.maxLength) return `Use at most ${d.maxLength} characters.`;
      if (d.pattern !== undefined && !new RegExp(d.pattern, d.patternFlags).test(text)) return 'It has a character the filter does not accept.';
      return null;
    }
    default: throw new Error(`jobs-feed-query: unknown value kind ${d.kind}`);
  }
}

// Throws on a value outside the registry domain. `name` is how the caller knows the filter (a flag or an argument).
function assertFeedFilterValue(entry, value, name = entry.param) {
  if (value === undefined || value === null || value === NO_FILTER_VALUES[entry.param]) return;
  if (!entry.multiple) {
    const why = domainError(entry, value);
    if (why) throw new Error(`Invalid ${name} value "${value}". ${why}`);
    return;
  }
  const items = listItems(entry, value);
  if (items.length === 0) throw new Error(`${name} needs at least one value.`);
  if (entry.maxItems !== undefined && items.length > entry.maxItems) throw new Error(`${name} takes at most ${entry.maxItems} distinct values.`);
  for (const item of items) {
    const why = domainError(entry, item);
    if (why) throw new Error(`Invalid ${name} value "${item}". ${why}`);
  }
}

// The wire value of one selection entry, or null when it sends nothing (absent, false, blank, or the server default).
function wireValue(entry, raw) {
  if (raw === undefined || raw === null) return null;
  if (isBool(entry)) return raw === true ? entry.values.trueValue : null;
  const text = entry.multiple ? listItems(entry, raw).join(',') : String(raw).trim();
  return text === '' || text === entry.wireDefault || text === NO_FILTER_VALUES[entry.param] ? null : text;
}

/**
 * The location combinations the backend reads differently from what a caller means, shared by `trackly jobs` and
 * the local MCP tool so neither accepts them. `remote` is the remote-only shorthand (usStates=REMOTE); `hasParent`
 * is a region or locationFilter. Throws on: remote with a state or province list (the backend would OR them, so
 * non-remote jobs in those places come back), and a parent region with remote or with only-REMOTE children (that
 * overrides the parent).
 */
function assertRemoteLocationRules({ remote = false, hasParent = false, usStates, caProvinces }) {
  if (remote && (usStates !== undefined || caProvinces !== undefined)) {
    throw new Error('remote cannot be combined with a state or province list: use remote alone for remote-only jobs, or include REMOTE in the list for alternatives.');
  }
  const children = [...(usStates ?? []), ...(caProvinces ?? [])];
  const remoteOnlyChildren = children.length > 0 && children.every((value) => value === 'REMOTE');
  if (hasParent && (remote || remoteOnlyChildren)) {
    throw new Error('remote (or REMOTE-only states and provinces) cannot be combined with a region: it overrides the region. Use the work arrangement filter (remote) with the region for remote work within that geography.');
  }
}

/**
 * Adds the feed filters of `selection` (values keyed by the registry's wire param names) to `qs`, the way
 * TracklyWeb sends them: lists comma-joined, a false flag and a default omitted, search-box text that needs the
 * keyword grammar sent as q. Domain-checked first; throws on a bad value. Returns `qs`.
 */
function buildFeedFilterQuery(selection, qs = new URLSearchParams()) {
  const picked = { ...selection };
  if (typeof picked.search === 'string' && picked.q === undefined && usesKeywordGrammar(picked.search, picked.qIn === 'all')) {
    picked.q = picked.search;
    delete picked.search;
  }
  for (const entry of FEED_FILTER_PARAMS) {
    assertFeedFilterValue(entry, picked[entry.param]);
    const value = wireValue(entry, picked[entry.param]);
    if (value !== null) qs.set(entry.param, value);
  }
  return qs;
}

// The selection a `trackly jobs` command line asks for, from the parsed flags. A list flag is comma-separated and
// a boolean flag takes no value. Throws a message naming the flag when a value is missing or outside its domain.
function selectionFromFlags(args) {
  const selection = {};
  for (const entry of FEED_FILTER_PARAMS) {
    const flag = cliFlag(entry);
    const raw = args[flag];
    if (raw === undefined) continue;
    if (isBool(entry)) {
      if (raw !== true) throw new Error(`--${flag} takes no value.`);
      selection[entry.param] = true;
      continue;
    }
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`--${flag} requires a value.`);
    const kind = entry.values.kind;
    const one = (text) => ((kind === 'int' || kind === 'intList') && /^-?\d+$/.test(text.trim()) ? Number(text) : text.trim());
    selection[entry.param] = entry.multiple ? raw.split(',').map(one) : one(raw);
    assertFeedFilterValue(entry, selection[entry.param], `--${flag}`);
  }
  return selection;
}

module.exports = {
  FEED_FILTER_PARAMS,
  NO_FILTER_VALUES,
  assertFeedFilterValue,
  assertRemoteLocationRules,
  buildFeedFilterQuery,
  cliFlag,
  mcpArg,
  registryValues,
  selectionFromFlags,
  usesKeywordGrammar,
};
