#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const DEFAULT_MAX_BYTES = 100000;

const EXCLUDED_BASENAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
]);

const ESCAPES = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};

function unquoteGitPath(value) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  const raw = [];
  const body = value.slice(1, -1);
  for (let index = 0; index < body.length;) {
    const character = body[index];
    if (character !== '\\') {
      raw.push(...Buffer.from(character, 'utf8'));
      index += 1;
      continue;
    }
    index += 1;
    if (index >= body.length) return value;
    const octal = body.slice(index, index + 3);
    if (/^[0-7]{3}$/u.test(octal)) {
      raw.push(Number.parseInt(octal, 8));
      index += 3;
      continue;
    }
    const escape = body[index];
    if (!Object.hasOwn(ESCAPES, escape)) return value;
    raw.push(ESCAPES[escape]);
    index += 1;
  }
  return Buffer.from(raw).toString('utf8');
}

function newPathFromDiffHeader(line) {
  if (!line.startsWith('diff --git ')) return null;
  const body = line.slice('diff --git '.length);
  const separator = ' b/';
  const quotedSeparator = ' "b/';
  let path = null;
  const quotedAt = body.lastIndexOf(quotedSeparator);
  const plainAt = body.lastIndexOf(separator);
  if (quotedAt !== -1 && quotedAt >= plainAt) {
    path = unquoteGitPath(`"${body.slice(quotedAt + quotedSeparator.length)}`);
  } else if (plainAt !== -1) {
    path = unquoteGitPath(body.slice(plainAt + separator.length));
  }
  return path || null;
}

function isExcludedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  const base = filePath.split('/').pop();
  return EXCLUDED_BASENAMES.has(base);
}

function filterDiff(unifiedDiff) {
  const text = typeof unifiedDiff === 'string' ? unifiedDiff : '';
  const out = [];
  const excluded = [];
  const kept = [];
  let keep = true;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const filePath = newPathFromDiffHeader(line);
      keep = !(filePath && isExcludedPath(filePath));
      if (!keep && filePath) excluded.push(filePath);
      else if (keep && filePath) kept.push(filePath);
    }
    if (keep) out.push(line);
  }
  return { diff: out.join('\n'), excluded, kept };
}

function packRank(filePath) {
  const path = typeof filePath === 'string' ? filePath : '';
  if (path.startsWith('scripts/')) return 0;
  if (path.startsWith('lib/') || path.startsWith('src/') || path.startsWith('mcp/')) return 1;
  if (path === 'package.json' || path === 'server.json') return 2;
  if (path.startsWith('plugins/')) return 3;
  if (path.startsWith('.github/')) return 4;
  if (path.startsWith('docs/')) return 5;
  if (path.startsWith('test/')) return 8;
  return 6;
}

function splitDiffSections(unifiedDiff) {
  const text = typeof unifiedDiff === 'string' ? unifiedDiff : '';
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push(current);
      current = { path: newPathFromDiffHeader(line), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function sectionText(section) {
  return section.lines.join('\n');
}

function prefixUtf8(text, maxBytes) {
  const buf = Buffer.from(text);
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const sliced = buf.subarray(0, end).toString('utf8');
  const lastNewline = sliced.lastIndexOf('\n');
  return lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
}

function packDiff(unifiedDiff, maxBytes) {
  const max = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0
    ? Number(maxBytes)
    : DEFAULT_MAX_BYTES;
  const sections = splitDiffSections(unifiedDiff);
  const ranked = sections
    .map((section, index) => ({ section, index, rank: packRank(section.path) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index);
  const selected = new Set();
  const skipped = [];
  let used = 0;
  for (const item of ranked) {
    const body = sectionText(item.section);
    const size = Buffer.byteLength(body) + (selected.size > 0 ? 1 : 0);
    if (used + size <= max) {
      selected.add(item.index);
      used += size;
      continue;
    }
    if (item.section.path) skipped.push(item.section.path);
  }
  let truncated = false;
  let includedSections = sections.filter((_, index) => selected.has(index));
  if (includedSections.length === 0 && ranked.length > 0) {
    const first = ranked[0].section;
    includedSections = [{ ...first, lines: prefixUtf8(sectionText(first), max).split('\n') }];
    truncated = true;
    skipped.length = 0;
    for (const item of ranked.slice(1)) {
      if (item.section.path) skipped.push(item.section.path);
    }
  }
  return {
    diff: includedSections.map((section) => sectionText(section)).join('\n'),
    included: includedSections.map((section) => section.path).filter(Boolean),
    skipped,
    truncated,
  };
}

function prepareReviewDiff(unifiedDiff, maxBytes) {
  const filtered = filterDiff(unifiedDiff);
  const source = filtered.excluded.length > 0 && Buffer.byteLength(filtered.diff) === 0
    ? unifiedDiff
    : filtered.diff;
  const packed = packDiff(source, maxBytes);
  return {
    diff: packed.diff,
    excluded: filtered.excluded,
    kept: packed.included,
    skipped: packed.skipped,
    truncated: packed.truncated,
  };
}

function main(argv) {
  const inputPath = argv[0];
  const outputPath = argv[1];
  const metaPath = argv[2];
  if (!inputPath || !outputPath || !metaPath) {
    process.stderr.write('usage: filter-claude-review-diff.js <input.diff> <output.diff> <meta.json> [maxBytes]\n');
    process.exit(2);
  }
  const maxBytes = Number.parseInt(argv[3] || String(DEFAULT_MAX_BYTES), 10);
  const prepared = prepareReviewDiff(fs.readFileSync(inputPath, 'utf8'), maxBytes);
  fs.writeFileSync(outputPath, prepared.diff);
  fs.writeFileSync(metaPath, `${JSON.stringify({
    excluded: prepared.excluded,
    kept: prepared.kept,
    skipped: prepared.skipped,
    truncated: prepared.truncated,
  })}\n`);
}

module.exports = {
  DEFAULT_MAX_BYTES,
  EXCLUDED_BASENAMES,
  filterDiff,
  isExcludedPath,
  newPathFromDiffHeader,
  packDiff,
  packRank,
  prepareReviewDiff,
};

if (require.main === module || process.argv[1] === '-') {
  main(process.argv.slice(2));
}
