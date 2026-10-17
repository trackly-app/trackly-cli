#!/usr/bin/env node
'use strict';
// Classify why a claude-code-action review attempt failed, from its execution
// file: did the Claude API refuse BOTH accounts for a usage limit? Same rule as
// TracklyWeb scripts/review/classify-attempts.mjs (14a407bf0).
//
// Usage: node classify-review-attempts.js <primary-execution-file> <fallback-execution-file>
// Prints three lines and always exits 0:
//   class=both-capped|other
//   primary=quota|auth|other|missing
//   fallback=quota|auth|other|missing
const { readFileSync } = require('node:fs');

// The CLI's own error strings have fixed, start-anchored shapes. Anything
// else in `result.result` is the model's final message and is never read.
const CLI_ERROR =
  /^(?:API Error\b|Error:|\{"type":"error"|You(?:'ve| have) hit your (?:usage|rate|weekly) limit|Claude AI usage limit reached|Request timed out|Timeout\b|Not logged in|Invalid API key|Claude (?:Code )?is at capacity)/;
const AUTH =
  /\b(?:401|403)\b|authentication_error|permission_error|unauthori[sz]ed|invalid (?:oauth|api) ?(?:token|key)|oauth token|not logged in|please run \/login/i;
// A busy API (529/overloaded) is not a usage cap, so it stays red.
const QUOTA = /\b429\b|rate.?limit|(?:usage|weekly) limit|quota|too many requests|credit balance/i;

function parseEvents(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.flat(1);
    return parsed && typeof parsed === 'object' ? [parsed] : [];
  } catch {
    // stream-json: one JSON object per line.
    const events = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        return [];
      }
    }
    return events;
  }
}

/** @returns {'quota' | 'auth' | 'other' | 'missing'} */
function classifyAttempt(input) {
  const events = (Array.isArray(input) ? input : parseEvents(input)).filter((e) => e && typeof e === 'object');
  const results = events.filter((e) => e.type === 'result');
  const result = results[results.length - 1];
  if (!result) return 'missing';
  // A refused first request costs nothing. A run that spent money produced
  // model output, and cap wording in it may come from the PR under review.
  if (result.is_error !== true || result.total_cost_usd !== 0) return 'other';
  const text = [result.result, result.error]
    .filter((t) => typeof t === 'string' && CLI_ERROR.test(t.trim()))
    .join(' ');
  if (AUTH.test(text)) return 'auth';
  if (QUOTA.test(text)) return 'quota';
  return 'other';
}

function readAttempt(file) {
  try {
    return classifyAttempt(readFileSync(file, 'utf8'));
  } catch {
    return 'missing';
  }
}

if (require.main === module) {
  const primary = readAttempt(process.argv[2] || '');
  const fallback = readAttempt(process.argv[3] || '');
  const both = primary === 'quota' && fallback === 'quota';
  process.stdout.write(`class=${both ? 'both-capped' : 'other'}\nprimary=${primary}\nfallback=${fallback}\n`);
}

module.exports = { classifyAttempt };
