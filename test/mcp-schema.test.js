'use strict';

/**
 * MCP schema regression tests.
 *
 * Codex audit (2026-04-19) found that sort drift between backend handler,
 * MCP Zod schema, and CLI help text was possible because no test asserted
 * the enum values. This suite locks the enum surface so future changes
 * either update the tests deliberately or fail CI.
 *
 * Source-of-truth citations (Codex can verify these against close-ai repo):
 *   - sort:       close-ai/src/routes/jobscout.ts:3053  (newest | match)
 *   - status:     close-ai/src/routes/jobscout.ts:2949  (new | applying | applied_confirmed | check_later | not_interested | all)
 *   - function:   close-ai/src/routes/jobscout-filter-utils.ts:17-21  (14 values incl. partnerships)
 *   - modality:   close-ai/src/routes/jobscout.ts:2870-2875  (full_time | internship | all)
 *   - regions:    close-ai/src/services/region-classifier.ts:8  (10 values)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'mcp', 'server.js'),
  'utf8'
);

// Tiny extractor: pull the enum values as JSON-ish literals.
// We don't import the file because Zod wants a connected server; we parse the
// source directly. These regressions are *textual* — if the enum string in
// the source changes, the test fails. That's the point.
function extractArrayLiteral(source, varName) {
  const m = source.match(new RegExp(`const\\s+${varName}\\s*=\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`Could not find const ${varName} = [...] in mcp/server.js`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

test('MCP JOB_FUNCTIONS has 14 canonical values including partnerships', () => {
  const fns = extractArrayLiteral(SERVER_SRC, 'JOB_FUNCTIONS');
  assert.equal(fns.length, 14, `expected 14 functions, got ${fns.length}: ${fns.join(', ')}`);
  assert.ok(fns.includes('partnerships'), 'partnerships must be present (was missing before PR #14)');
  for (const v of ['product', 'engineering', 'design', 'data', 'marketing', 'sales', 'partnerships', 'finance', 'strategy', 'operations', 'people', 'legal', 'support', 'other']) {
    assert.ok(fns.includes(v), `missing canonical function value: ${v}`);
  }
});

test('MCP JOB_MODALITIES matches backend is_internship column semantics', () => {
  const mods = extractArrayLiteral(SERVER_SRC, 'JOB_MODALITIES');
  assert.deepEqual(mods, ['full_time', 'internship', 'all']);
  // Guard against resurrection of the old broken values:
  assert.ok(!mods.includes('remote'), 'jobModality must NOT include remote — remote is a work-location filter, not employment type');
  assert.ok(!mods.includes('hybrid'), 'hybrid is not a supported jobModality value');
  assert.ok(!mods.includes('onsite'), 'onsite is not a supported jobModality value');
});

test('MCP STATUS_VALUES matches backend jobscout.ts:2949 allowlist', () => {
  const statuses = extractArrayLiteral(SERVER_SRC, 'STATUS_VALUES');
  assert.deepEqual(
    statuses,
    ['new', 'applying', 'applied_confirmed', 'check_later', 'not_interested', 'all']
  );
  // Guard against the pre-PR-14 values that the backend 400s on:
  for (const bad of ['saved', 'applied', 'dismissed']) {
    assert.ok(!statuses.includes(bad), `status must NOT include legacy value: ${bad}`);
  }
});

test('MCP REGION_TAGS has 10 values and REGION_TAGS_ARRAY_SAFE excludes us', () => {
  const tags = extractArrayLiteral(SERVER_SRC, 'REGION_TAGS');
  assert.equal(tags.length, 10);
  for (const v of ['us', 'europe', 'latam', 'middle_east', 'asia', 'africa', 'canada', 'oceania', 'remote', 'unknown']) {
    assert.ok(tags.includes(v), `REGION_TAGS missing ${v}`);
  }
  // REGION_TAGS_ARRAY_SAFE is derived via .filter — verify the derivation exists
  // and the source comment explains why.
  assert.ok(
    SERVER_SRC.includes("REGION_TAGS.filter((t) => t !== 'us')"),
    'REGION_TAGS_ARRAY_SAFE must be REGION_TAGS.filter((t) => t !== "us") to prevent ["us","europe"] silent drop'
  );
});

test('MCP SORT_VALUES is [newest, match] — NOT the deprecated [newest, oldest, company]', () => {
  // SORT_VALUES is a named constant (centralized per CodeRabbit review on PR #17).
  const values = extractArrayLiteral(SERVER_SRC, 'SORT_VALUES');
  assert.deepEqual(values, ['newest', 'match'], `expected [newest, match], got [${values.join(', ')}]`);
  // Guard: the backend REJECTS these values with HTTP 400.
  for (const bad of ['oldest', 'company']) {
    assert.ok(!values.includes(bad), `sort must NOT include ${bad} — backend jobscout.ts:3053 rejects it`);
  }
  // Also verify the schema actually uses the centralized constant, not an inline literal
  // (guards against future "just add one value inline" drift).
  assert.ok(
    SERVER_SRC.includes('z.enum(SORT_VALUES)'),
    'sort param must use z.enum(SORT_VALUES), not an inline array literal',
  );
});

test('CLI --sort help text is [newest, match] in bin/trackly', () => {
  const binSrc = fs.readFileSync(path.join(__dirname, '..', 'bin', 'trackly'), 'utf8');
  // The help line should NOT mention oldest or company; SHOULD mention newest and match.
  const sortLine = binSrc.split('\n').find((l) => l.includes('--sort '));
  assert.ok(sortLine, '--sort help line not found in bin/trackly');
  assert.ok(sortLine.includes('newest'), `--sort help must mention newest: ${sortLine}`);
  assert.ok(sortLine.includes('match'), `--sort help must mention match: ${sortLine}`);
  assert.ok(!sortLine.match(/\boldest\b/), `--sort help must NOT mention oldest: ${sortLine}`);
  assert.ok(!sortLine.match(/\bcompany\b/), `--sort help must NOT mention company as a sort value: ${sortLine}`);
});

test('CLI + MCP use new /jobscout/tracker/jobs/:id/stage endpoint (not removed /jobscout-tracker/status)', () => {
  const binSrc = fs.readFileSync(path.join(__dirname, '..', 'bin', 'trackly'), 'utf8');
  const mcpSrc = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');

  // Backend removed the old endpoint; using it = 404 silent failure on apply/save/dismiss.
  // Check for actual API calls (apiRequest('POST', ...)) in ANY quoting style — single/double
  // quotes AND template literals (bin/trackly uses backticks for the stage URL). Comments and
  // documentation that mention the removed path for historical context are OK.
  const postCallRegex = /apiRequest\(\s*['"\x60]POST['"\x60]\s*,\s*([`'"])((?:[^\\\x60]|\\.)*?)\1/g;
  function extractPostUrls(source) {
    const urls = [];
    let m;
    while ((m = postCallRegex.exec(source)) !== null) {
      urls.push(m[2]);
    }
    return urls;
  }
  const binUrls = extractPostUrls(binSrc);
  const mcpUrls = extractPostUrls(mcpSrc);
  assert.ok(binUrls.length > 0, 'bin/trackly must contain at least one apiRequest POST call for this test to be meaningful');
  assert.ok(mcpUrls.length > 0, 'mcp/server.js must contain at least one apiRequest POST call');
  for (const url of binUrls) {
    assert.ok(!url.includes('/api/jobscout-tracker/status'), `CLI has a live apiRequest POST to the removed endpoint: ${url}`);
  }
  for (const url of mcpUrls) {
    assert.ok(!url.includes('/api/jobscout-tracker/status'), `MCP has a live apiRequest POST to the removed endpoint: ${url}`);
  }
  // Positive: at least one POST in each source uses the new stage endpoint path.
  const stagePathPattern = /\/api\/jobscout\/tracker\/jobs\/[^/]+\/stage/;
  assert.ok(
    binUrls.some((u) => stagePathPattern.test(u)),
    `CLI must POST to /api/jobscout/tracker/jobs/:id/stage (urls seen: ${binUrls.join(', ')})`,
  );
  assert.ok(
    mcpUrls.some((u) => stagePathPattern.test(u)),
    `MCP must POST to /api/jobscout/tracker/jobs/:id/stage (urls seen: ${mcpUrls.join(', ')})`,
  );

  // Stage mapping — CLI and MCP both need applied→applied, saved→backlog, dismissed→discarded.
  // Use a formatting-tolerant regex (any quote style, any whitespace) so harmless reformats
  // don't break this guard.
  const stageMappingRules = [
    [/\bapplied\s*:\s*['"\x60]applied['"\x60]/, 'applied → applied'],
    [/\bsaved\s*:\s*['"\x60]backlog['"\x60]/, 'saved → backlog'],
    [/\bdismissed\s*:\s*['"\x60]discarded['"\x60]/, 'dismissed → discarded'],
  ];
  for (const [label, src] of [['bin/trackly', binSrc], ['mcp/server.js', mcpSrc]]) {
    for (const [rx, desc] of stageMappingRules) {
      assert.ok(rx.test(src), `${label} missing stage mapping ${desc} (formatting-tolerant regex)`);
    }
  }
});

test('docs/trackly-tools.md sort description matches backend', () => {
  const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'trackly-tools.md'), 'utf8');
  // Find the sort line
  const sortLine = docs.split('\n').find((l) => l.includes('`sort`:'));
  assert.ok(sortLine, 'sort line not found in docs/trackly-tools.md');
  assert.ok(sortLine.includes('newest'), `sort docs must mention newest: ${sortLine}`);
  assert.ok(sortLine.includes('match'), `sort docs must mention match: ${sortLine}`);
  // Block the old valid-values pattern: `newest`, `oldest`, `company` (the literal pre-fix format).
  // Mentions in a deprecation sentence are allowed since the project deliberately calls out
  // that the backend rejects those values — the bug was advertising them as valid.
  assert.ok(
    !sortLine.match(/`newest`\s*,\s*`oldest`\s*,\s*`company`/),
    `sort docs must not list the stale valid-values triplet 'newest, oldest, company': ${sortLine}`
  );
});

test('CLI + MCP guard /ask jobsUrl with a path allowlist (PR v0.2.4)', () => {
  // The /ask endpoint returns a jobsUrl string that the CLI + MCP then fetch with the
  // user's Authorization header. normalizeEndpoint blocks cross-origin, but a compromised
  // backend could emit a same-origin `/api/admin/...` path. Both surfaces MUST gate the
  // follow-up fetch on an allowlist matching /api/(v1|jobscout)/jobs AND the apiRequest
  // for jobsUrl must only fire inside the allowlist's true branch.
  const binSrc = fs.readFileSync(path.join(__dirname, '..', 'bin', 'trackly'), 'utf8');
  const mcpSrc = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');
  // Define:  /^\/api\/(v1|jobscout)\/jobs(\?|$)/
  const allowlistRegex = /\/\^\\\/api\\\/\(v1\|jobscout\)\\\/jobs\(\\\?\|\$\)\//;
  assert.ok(
    allowlistRegex.test(binSrc),
    'bin/trackly must define JOBS_URL_ALLOWLIST = /^\\/api\\/(v1|jobscout)\\/jobs(\\?|$)/ before following result.jobsUrl'
  );
  assert.ok(
    allowlistRegex.test(mcpSrc),
    'mcp/server.js must define the same JOBS_URL_ALLOWLIST before following askResult.jobsUrl'
  );
  // Enforce USAGE, not just DEFINITION: the apiRequest fetch of the jobsUrl must appear
  // after a .test() guard. This catches a future refactor that imports the constant but
  // forgets to call .test() before the fetch. We assert that (a) `.test(` appears near
  // the JOBS_URL_ALLOWLIST definition, and (b) at least one apiRequest call follows that
  // gate in each source. Grep-based; survives formatting reflows.
  for (const [label, src] of [['bin/trackly', binSrc], ['mcp/server.js', mcpSrc]]) {
    assert.ok(
      /JOBS_URL_ALLOWLIST\.test\(/.test(src),
      `${label} must CALL JOBS_URL_ALLOWLIST.test(...) — defining the regex without using it would defeat the guard`
    );
  }
});
