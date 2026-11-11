#!/usr/bin/env node
'use strict';

// Builds the two Claude downloads attached to each trackly-cli GitHub release:
//   trackly-apply-claude-skill-<version>.zip  claude.ai skill upload (one trackly-apply/ folder)
//   trackly-claude-plugin-<version>.zip       Claude Code local marketplace with the trackly plugin,
//                                             under one trackly-claude-plugin-<version>/ folder
// The archives are deterministic: sorted entries, fixed timestamps and permissions, and
// stored (uncompressed) entries, so the same source produces the same bytes and SHA-256
// on any Node or zlib build.
//
// Usage: node scripts/build-claude-downloads.js [--out <dir>] [--json]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugins', 'trackly-claude');
const SKILL_ROOT = path.join(PLUGIN_ROOT, 'skills', 'trackly-apply');
const MARKETPLACE_NAME = 'trackly-claude';
const PLUGIN_DIRECTORY = 'trackly';
// 1980-01-01 00:00 in MS-DOS date/time format, the earliest representable value.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function listFiles(directory, prefix = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Refusing to package a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...listFiles(absolute, relative));
    else if (entry.isFile()) files.push({ name: relative, data: fs.readFileSync(absolute) });
    else throw new Error(`Refusing to package a special file: ${relative}`);
  }
  return files;
}

// zlib.crc32 exists on every Node version package.json allows (^20.20.0 || >=22.22.0).
function crc32(data) {
  return zlib.crc32(data) >>> 0;
}

/** Minimal deterministic ZIP writer (stored entries, no extra fields, UTF-8 names). */
function zip(files) {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    if (names.has(name)) throw new Error(`Duplicate archive entry: ${name}`);
    if (!name || name.startsWith('/') || name.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error(`Unsafe archive entry: ${name}`);
    }
    names.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    // Stored, not deflated: deflate output can differ between zlib builds.
    const compressed = data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4); // version needed for stored entries
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, spec 2.0
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Reads entry names and contents back from an archive this module wrote. */
function readZip(buffer) {
  if (buffer.length < 22) throw new Error('Missing end of central directory');
  const endOffset = buffer.length - 22;
  if (buffer.readUInt32LE(endOffset) !== 0x06054b50) throw new Error('Missing end of central directory');
  const inBounds = (offset, length) => offset >= 0 && offset + length <= buffer.length;
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (!inBounds(cursor, 46) || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (!inBounds(cursor + 46, nameLength) || !inBounds(localOffset, 30)) throw new Error('Archive entry out of bounds');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (!inBounds(dataStart, compressedSize)) throw new Error(`Archive data out of bounds for ${name}`);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression method ${method} for ${name}`);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(data) !== buffer.readUInt32LE(cursor + 16)) throw new Error(`CRC mismatch for ${name}`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function pluginManifest() {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
}

function marketplaceManifest(manifest) {
  return {
    name: MARKETPLACE_NAME,
    owner: { name: manifest.author.name, email: manifest.author.email },
    metadata: { description: 'Trackly Apply for Claude Code, from the trackly-cli release downloads.' },
    plugins: [{
      name: manifest.name,
      source: `./${PLUGIN_DIRECTORY}`,
      description: manifest.description,
      version: manifest.version,
      homepage: manifest.homepage,
    }],
  };
}

function buildDownloads({ version = require(path.join(ROOT, 'package.json')).version } = {}) {
  const manifest = pluginManifest();
  const skillFiles = listFiles(SKILL_ROOT).map(({ name, data }) => ({ name: `trackly-apply/${name}`, data }));
  // One top-level folder, so plain `unzip` creates the directory the README names.
  const pluginFolder = `trackly-claude-plugin-${version}`;
  const pluginFiles = [
    { name: `${pluginFolder}/.claude-plugin/marketplace.json`, data: Buffer.from(`${JSON.stringify(marketplaceManifest(manifest), null, 2)}\n`) },
    ...listFiles(PLUGIN_ROOT).map(({ name, data }) => ({ name: `${pluginFolder}/${PLUGIN_DIRECTORY}/${name}`, data })),
  ];
  return [
    { filename: `trackly-apply-claude-skill-${version}.zip`, kind: 'claude_ai_skill', files: skillFiles },
    { filename: `trackly-claude-plugin-${version}.zip`, kind: 'claude_code_plugin', files: pluginFiles },
  ].map((download) => {
    const bytes = zip(download.files);
    return { ...download, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
}

function main(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf('--out');
  const outDir = path.resolve(outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : path.join(ROOT, 'dist', 'claude'));
  fs.mkdirSync(outDir, { recursive: true });
  const downloads = buildDownloads();
  const summary = downloads.map(({ filename, kind, files, bytes, sha256 }) => {
    fs.writeFileSync(path.join(outDir, filename), bytes);
    return { filename, kind, entries: files.length, bytes: bytes.length, sha256 };
  });
  fs.writeFileSync(
    path.join(outDir, 'SHA256SUMS'),
    summary.map(({ sha256, filename }) => `${sha256}  ${filename}`).join('\n') + '\n',
  );
  if (argv.includes('--json')) console.log(JSON.stringify({ outDir, downloads: summary }, null, 2));
  else for (const { filename, sha256 } of summary) console.log(`${sha256}  ${path.join(outDir, filename)}`);
}

if (require.main === module) main();

module.exports = { MARKETPLACE_NAME, PLUGIN_DIRECTORY, buildDownloads, marketplaceManifest, readZip, zip };
