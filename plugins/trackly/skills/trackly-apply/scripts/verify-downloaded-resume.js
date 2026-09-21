#!/usr/bin/env node
'use strict';

// Local bytes only. This helper neither grants approval nor downloads documents.
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_BYTES = 10 * 1024 * 1024;
const fail = () => { throw new Error('Resume verification failed'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function assertSupportedPlatform(platform = process.platform, constants = fs.constants) {
  if (!['darwin', 'linux'].includes(platform) ||
      !Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW <= 0 ||
      !Number.isInteger(constants.O_NONBLOCK) || constants.O_NONBLOCK <= 0) fail();
}

async function verifyDownloadedResume(downloadedPath, metadata) {
  assertSupportedPlatform();
  if (typeof downloadedPath !== 'string' || !path.isAbsolute(downloadedPath) || downloadedPath.includes('\0')) fail();
  if (!metadata || typeof metadata !== 'object') fail();
  const { filename, sha256, sizeBytes } = metadata;
  if (typeof filename !== 'string' || !filename || Buffer.byteLength(filename) > 240 ||
      /[\x00-\x1f\x7f/\\:<>"|?*]/.test(filename) || filename === '.' || filename === '..' ||
      /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(filename) ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_BYTES) fail();
  let source;
  let destination;
  let directory;
  try {
    const before = await fsp.lstat(downloadedPath);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== sizeBytes) fail();
    source = await fsp.open(downloadedPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = await source.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== sizeBytes) fail();
    const bytes = Buffer.alloc(sizeBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await source.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await source.stat();
    if (offset !== sizeBytes || after.size !== sizeBytes || after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs || hash(bytes.subarray(0, offset)) !== sha256) fail();
    await source.close();
    source = undefined;
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'trackly-approved-resume-'));
    await fsp.chmod(directory, 0o700);
    const privateDirectory = await fsp.lstat(directory);
    if (!privateDirectory.isDirectory() || privateDirectory.isSymbolicLink() || (privateDirectory.mode & 0o777) !== 0o700) fail();
    const outputPath = path.join(directory, filename);
    destination = await fsp.open(outputPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
    await destination.writeFile(bytes.subarray(0, offset));
    await destination.sync();
    const copy = Buffer.alloc(sizeBytes + 1);
    let copied = 0;
    while (copied < copy.length) {
      const { bytesRead } = await destination.read(copy, copied, copy.length - copied, copied);
      if (!bytesRead) break;
      copied += bytesRead;
    }
    if (copied !== sizeBytes || hash(copy.subarray(0, copied)) !== sha256) fail();
    await destination.chmod(0o400);
    if (((await destination.stat()).mode & 0o777) !== 0o400) fail();
    await destination.close();
    destination = undefined;
    return { path: outputPath, filename, sha256, sizeBytes, verified: true };
  } catch {
    if (source) await source.close().catch(() => {});
    if (destination) await destination.close().catch(() => {});
    // Only remove this invocation's generated copy, never the downloaded source.
    if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    fail();
  }
}

async function main(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--path', '--filename', '--sha256', '--size'].includes(key) || key in values || args[i + 1] === undefined) fail();
    values[key] = args[i + 1];
  }
  if (!/^[1-9][0-9]*$/.test(values['--size'] || '')) fail();
  return verifyDownloadedResume(values['--path'], {
    filename: values['--filename'], sha256: values['--sha256'], sizeBytes: Number(values['--size']),
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    process.stderr.write('Resume verification failed. Check the approved file and metadata.\n');
    process.exitCode = 1;
  });
}
module.exports = { verifyDownloadedResume, MAX_BYTES, assertSupportedPlatform };
