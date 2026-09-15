#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

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

function main(argv) {
  const inputPath = argv[0];
  const outputPath = argv[1];
  const metaPath = argv[2];
  if (!inputPath || !outputPath || !metaPath) {
    process.stderr.write('usage: filter-claude-review-diff.js <input.diff> <output.diff> <meta.json>\n');
    process.exit(2);
  }
  const { diff, excluded, kept } = filterDiff(fs.readFileSync(inputPath, 'utf8'));
  fs.writeFileSync(outputPath, diff);
  fs.writeFileSync(metaPath, `${JSON.stringify({ excluded, kept })}\n`);
}

module.exports = {
  EXCLUDED_BASENAMES,
  filterDiff,
  isExcludedPath,
  newPathFromDiffHeader,
};

if (require.main === module || process.argv[1] === '-') {
  main(process.argv.slice(2));
}
