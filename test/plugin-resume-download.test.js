'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const helper = '../plugins/trackly/skills/trackly-apply/scripts/verify-downloaded-resume.js';
const { verifyDownloadedResume, MAX_BYTES, assertSupportedPlatform } = require(helper);
const bytes = Buffer.from('%PDF-1.7\nOriginal bytes\0\xff', 'utf8');
const approved = { filename: 'Resume - Test Applicant.pdf', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trackly-verifier-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'browser-download.pdf');
  await fs.writeFile(file, bytes);
  return { dir, file };
}
test('verifies original bytes and preserves the exact approved filename in a private copy', async t => {
  const { file } = await fixture(t);
  const proof = await verifyDownloadedResume(file, approved);
  t.after(() => fs.rm(path.dirname(proof.path), { recursive: true, force: true }));
  assert.deepEqual(proof, { ...approved, path: proof.path, verified: true });
  assert.equal(path.basename(proof.path), approved.filename);
  assert.notEqual(proof.path, file);
  assert.deepEqual(await fs.readFile(proof.path), bytes);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal((await fs.stat(path.dirname(proof.path))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(proof.path)).mode & 0o777, 0o400);
});
test('rejects wrong digest, lengths, non-files and symlinks without changing source', async t => {
  const { file, dir } = await fixture(t);
  for (const metadata of [{ ...approved, sha256: '0'.repeat(64) }, { ...approved, sizeBytes: bytes.length + 1 }, { ...approved, sizeBytes: bytes.length - 1 }]) {
    await assert.rejects(verifyDownloadedResume(file, metadata), /^Error: Resume verification failed$/);
  }
  const link = path.join(dir, 'link.pdf');
  await fs.symlink(file, link);
  await assert.rejects(verifyDownloadedResume(link, approved));
  await assert.rejects(verifyDownloadedResume(dir, approved));
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('rejects unsafe filenames and invalid approved metadata', async t => {
  const { file } = await fixture(t);
  for (const filename of ['', '..', '.', '../escape.pdf', '/escape.pdf', 'a\\b.pdf', 'a:b.pdf', 'a<b.pdf', 'a>b.pdf', 'a"b.pdf', 'a|b.pdf', 'a?b.pdf', 'a*b.pdf', 'a\0.pdf', 'a\n.pdf', 'NUL.pdf', 'COM1.pdf', 'LPT9', 'trailing.', 'trailing ', 'x'.repeat(241)]) {
    await assert.rejects(verifyDownloadedResume(file, { ...approved, filename }));
  }
  for (const sizeBytes of [0, -1, 1.5, '24', NaN, Infinity, MAX_BYTES + 1]) {
    await assert.rejects(verifyDownloadedResume(file, { ...approved, sizeBytes }));
  }
  for (const sha256 of ['', 'abc', 'A'.repeat(64), null]) await assert.rejects(verifyDownloadedResume(file, { ...approved, sha256 }));
  for (const metadata of [null, undefined, {}, 'metadata']) await assert.rejects(verifyDownloadedResume(file, metadata));
  for (const input of ['relative.pdf', 'https://example.com/file.pdf', '', null, '/tmp/file\0.pdf']) await assert.rejects(verifyDownloadedResume(input, approved));
});
test('fails closed on unsupported platforms or unavailable safe file-open flags', () => {
  const supportedFlags = { O_NOFOLLOW: 0x20000, O_NONBLOCK: 0x800 };
  for (const platform of ['linux', 'darwin']) assert.doesNotThrow(() => assertSupportedPlatform(platform, supportedFlags));
  for (const platform of ['win32', 'freebsd', 'unknown']) assert.throws(() => assertSupportedPlatform(platform, supportedFlags));
  for (const missing of ['O_NOFOLLOW', 'O_NONBLOCK']) {
    for (const value of [undefined, 0, -1, 1.5, '1']) assert.throws(() => assertSupportedPlatform('linux', { ...supportedFlags, [missing]: value }));
  }
});
test('entrypoint refuses unsupported platform before reading or copying the source', async t => {
  const { file } = await fixture(t);
  const program = `Object.defineProperty(process, 'platform', { value: 'win32' }); require(${JSON.stringify(require.resolve(helper))}).verifyDownloadedResume(${JSON.stringify(file)}, ${JSON.stringify(approved)}).then(() => process.exitCode = 99, error => { process.stderr.write(error.message); process.exitCode = 1; });`;
  const result = spawnSync(process.execPath, ['-e', program], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Resume verification failed');
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('rejects filesystems that do not enforce private directory permissions', async t => {
  const { file } = await fixture(t);
  const originalChmod = fs.chmod;
  let createdDirectory;
  t.after(() => { fs.chmod = originalChmod; });
  fs.chmod = async function (target, mode) {
    if (mode === 0o700) {
      createdDirectory = target;
      return originalChmod(target, 0o755);
    }
    return originalChmod(target, mode);
  };
  await assert.rejects(verifyDownloadedResume(file, approved));
  assert.ok(createdDirectory);
  await assert.rejects(fs.stat(createdDirectory), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('rejects oversized downloaded files even with small claimed size', async t => {
  const { file } = await fixture(t);
  await fs.truncate(file, MAX_BYTES + 1);
  await assert.rejects(verifyDownloadedResume(file, approved));
  await assert.rejects(verifyDownloadedResume(file, { ...approved, sizeBytes: MAX_BYTES + 1 }));
});
test('rejects a source replacement between lstat and open', async t => {
  const { file, dir } = await fixture(t);
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async function (target, ...args) {
    if (target === file) {
      await fs.rename(file, path.join(dir, 'original.pdf'));
      await fs.writeFile(file, bytes);
      fs.open = originalOpen;
    }
    return originalOpen.call(this, target, ...args);
  };
  await assert.rejects(verifyDownloadedResume(file, approved));
});
test('CLI errors never echo private input or filesystem exceptions', () => {
  const result = spawnSync(process.execPath, [require.resolve(helper), '--path', '/private/secret-person-file.pdf', '--filename', approved.filename, '--sha256', approved.sha256, '--size', String(approved.sizeBytes)], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Resume verification failed. Check the approved file and metadata.\n');
});
test('CLI rejects duplicate and unknown flags before materializing a valid file', async t => {
  const { file } = await fixture(t);
  const valid = ['--path', file, '--filename', approved.filename, '--sha256', approved.sha256, '--size', String(approved.sizeBytes)];
  for (const extra of [['--path', file], ['--filename', approved.filename], ['--sha256', approved.sha256], ['--size', String(approved.sizeBytes)], ['--unknown', 'value'], ['--size'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [require.resolve(helper), ...valid, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 1, `must reject ${extra[0]}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Resume verification failed. Check the approved file and metadata.\n');
  }
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('hosted skill links the transfer reference and its executable verifier', async () => {
  const skillDirectory = path.resolve(__dirname, '../plugins/trackly/skills/trackly-apply');
  const skill = await fs.readFile(path.join(skillDirectory, 'SKILL.md'), 'utf8');
  const referenceName = 'references/approved-download-transfer.md';
  assert.ok(skill.includes(`](${referenceName})`), 'transfer reference must be reachable from the skill');
  const reference = await fs.readFile(path.join(skillDirectory, referenceName), 'utf8');
  assert.ok(reference.includes('scripts/verify-downloaded-resume.js'), 'reference must name the packaged verifier');
  assert.equal(await fs.realpath(path.join(skillDirectory, 'scripts/verify-downloaded-resume.js')), await fs.realpath(require.resolve(helper)));
});
