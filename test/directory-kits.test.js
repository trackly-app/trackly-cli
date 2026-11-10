'use strict';

// close-ai #3601 (U9): the ChatGPT 1.0.9 and Claude v2 listing kits, the Claude
// Trackly Apply skill and its two downloads.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CLAUDE_PLUGIN,
  CLAUDE_SKILL,
  ENDPOINTS,
  LISTING,
  markdownToolRows,
  parseFrontmatter,
  verifyDirectoryKits,
} = require('../scripts/verify-directory-kits');
const { buildDownloads, readZip, zip, PLUGIN_DIRECTORY, MARKETPLACE_NAME } = require('../scripts/build-claude-downloads');

const REPO = path.resolve(__dirname, '..');
const claudeCatalog = JSON.parse(fs.readFileSync(path.join(LISTING, 'claude', 'tools.json'), 'utf8'));
const openaiCatalog = JSON.parse(fs.readFileSync(path.join(LISTING, 'openai', 'tools.json'), 'utf8'));

/**
 * Copies the kit sources into a temporary root, applies one mutation there and runs the
 * checks against the copy, so parallel test files never see a modified source file.
 */
function withMutatedFile(file, mutate, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-directory-kits-'));
  try {
    for (const relative of ['plugins/trackly/listing', 'plugins/trackly-claude', 'plugins/trackly/hosted-contract-fixture.json']) {
      fs.cpSync(path.join(REPO, relative), path.join(root, relative), { recursive: true });
    }
    const target = path.join(root, path.relative(REPO, file));
    const original = fs.readFileSync(target, 'utf8');
    const changed = mutate(original);
    assert.notEqual(changed, original, `mutation must change ${path.relative(REPO, file)}`);
    fs.writeFileSync(target, changed);
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('directory kits, Claude plugin and Claude skill pass the offline checks', () => {
  assert.deepEqual(verifyDirectoryKits(), []);
});

test('captured catalogs match the deployed directory counts', () => {
  assert.equal(openaiCatalog.tools.length, 38);
  assert.equal(claudeCatalog.tools.length, 37);
  assert.equal(claudeCatalog.tools.filter(({ listedFor }) => listedFor === 'all_users').length, 21);
  assert.equal(claudeCatalog.tools.filter(({ listedFor }) => listedFor === 'apply_allowlist').length, 16);
  const claudeNames = new Set(claudeCatalog.tools.map(({ name }) => name));
  // Claude has no readiness aggregate and never the unsplit dispatchers (KTD6).
  for (const name of ['trackly_get_apply_readiness', 'trackly_report_apply_progress', 'trackly_get_apply_work']) {
    assert.equal(claudeNames.has(name), false, name);
  }
  assert.equal(openaiCatalog.endpoint, ENDPOINTS.openai);
  assert.equal(claudeCatalog.endpoint, ENDPOINTS.claude);
});

test('every tool the Claude skill names exists in the Claude catalog', () => {
  const names = new Set(claudeCatalog.tools.map(({ name }) => name));
  const referenced = new Set();
  for (const file of ['SKILL.md', ...fs.readdirSync(path.join(CLAUDE_SKILL, 'references')).map((name) => `references/${name}`)]) {
    for (const [token] of fs.readFileSync(path.join(CLAUDE_SKILL, file), 'utf8').matchAll(/\btrackly_[a-z_]+\b/g)) referenced.add(token);
  }
  assert.ok(referenced.size >= 25, `the skill should drive most of the catalog (named ${referenced.size})`);
  assert.deepEqual([...referenced].filter((name) => !names.has(name)), []);
});

test('Claude skill frontmatter is a valid claude.ai skill header', () => {
  const frontmatter = parseFrontmatter(fs.readFileSync(path.join(CLAUDE_SKILL, 'SKILL.md'), 'utf8'));
  assert.equal(frontmatter.name, 'trackly-apply');
  assert.ok(frontmatter.description.length <= 1024);
  assert.match(frontmatter.description, /Claude in Chrome/);
  assert.equal(parseFrontmatter('no frontmatter'), null);
});

test('skill checks reject non-Claude tools, surfaces, resume approval and broken links', () => {
  const skill = path.join(CLAUDE_SKILL, 'SKILL.md');
  const cases = [
    [(text) => text.replace('`trackly_get_profile_onboarding` returns', '`trackly_get_apply_readiness` returns'), /does not list: trackly_get_apply_readiness/],
    [(text) => `${text}\nUse browserSurface: codex_in_app here.\n`, /browser surface codex_in_app|sets browserSurface to codex_in_app/],
    [(text) => `${text}\nCall \`trackly_approve_apply_resume\` after the preview.\n`, /only to forbid it/],
    [(text) => text.replace('Never activate the final Submit control.', 'Avoid the final Submit control.'), /keep the rule: Never activate/],
    [(text) => text.replace('(references/onboarding.md)', '(references/missing.md)'), /missing file: references\/missing\.md/],
    [(text) => text.replace('name: trackly-apply', 'name: Trackly Apply'), /name must be trackly-apply/],
  ];
  for (const [mutate, expected] of cases) {
    const errors = withMutatedFile(skill, mutate, (root) => verifyDirectoryKits({ root }));
    assert.ok(errors.some((message) => expected.test(message)), `${expected}: ${errors.join(' | ')}`);
  }
});

test('plugin and kit checks reject a wrong connector, count drift and table drift', () => {
  const cases = [
    [path.join(CLAUDE_PLUGIN, '.mcp.json'), (text) => text.replace('/claude/mcp', '/openai/mcp'), /exactly the Trackly Claude connector/],
    [path.join(CLAUDE_PLUGIN, '.claude-plugin', 'plugin.json'), (text) => text.replace('"./.mcp.json"', '"./other.json"'), /load \.\/\.mcp\.json/],
    [path.join(LISTING, 'claude', 'metadata.json'), (text) => text.replace('"allUsers": 21', '"allUsers": 20'), /allUsers count/],
    [path.join(LISTING, 'claude', 'README.md'), (text) => text.replace('| `trackly_stop_apply` | Stop Trackly Apply | destructive |', '| `trackly_stop_apply` | Stop Trackly Apply | non-destructive |'), /annotation is wrong for trackly_stop_apply/],
    [path.join(LISTING, 'openai', 'metadata.json'), (text) => text.replace('"packageVersion": "1.0.9"', '"packageVersion": "1.0.8"'), /package 1\.0\.9/],
    [path.join(LISTING, 'openai', 'README.md'), (text) => text.replace(/\| `trackly_add_tracker_note` \|.*\n/, ''), /one justification row per new tool/],
    // A hosted-contract recapture without a catalog recapture leaves the kits stale.
    [path.join(REPO, 'plugins', 'trackly', 'hosted-contract-fixture.json'), (text) => text.replace(/"commit": "6a5b05f5[0-9a-f]+"/, '"commit": "0000000000000000000000000000000000000000"'), /same close-ai commit as hosted-contract-fixture\.json/],
  ];
  for (const [file, mutate, expected] of cases) {
    const errors = withMutatedFile(file, mutate, (root) => verifyDirectoryKits({ root }));
    assert.ok(errors.some((message) => expected.test(message)), `${expected}: ${errors.join(' | ')}`);
  }
});

test('markdown tool rows reject a duplicated tool', () => {
  assert.throws(() => markdownToolRows('| `trackly_a` | x |\n| `trackly_a` | y |'), /more than one table row/);
});

test('Claude downloads are deterministic and contain the skill and plugin', () => {
  const [skill, plugin] = buildDownloads({ version: '9.9.9' });
  const again = buildDownloads({ version: '9.9.9' });
  assert.equal(skill.filename, 'trackly-apply-claude-skill-9.9.9.zip');
  assert.equal(plugin.filename, 'trackly-claude-plugin-9.9.9.zip');
  assert.equal(skill.sha256, again[0].sha256);
  assert.equal(plugin.sha256, again[1].sha256);

  const skillEntries = readZip(skill.bytes);
  const skillNames = skillEntries.map(({ name }) => name);
  assert.ok(skillNames.every((name) => name.startsWith('trackly-apply/')), 'one top-level skill folder');
  assert.ok(skillNames.includes('trackly-apply/SKILL.md'));
  for (const { name, data } of skillEntries) {
    assert.deepEqual(data, fs.readFileSync(path.join(CLAUDE_SKILL, name.slice('trackly-apply/'.length))), name);
  }

  // One top-level folder, so plain `unzip` creates the directory the plugin README names.
  const folder = 'trackly-claude-plugin-9.9.9';
  const pluginRaw = readZip(plugin.bytes);
  assert.ok(pluginRaw.every(({ name }) => name.startsWith(`${folder}/`)), 'one top-level plugin folder');
  const pluginEntries = new Map(pluginRaw.map(({ name, data }) => [name.slice(folder.length + 1), data]));
  const marketplace = JSON.parse(pluginEntries.get('.claude-plugin/marketplace.json'));
  const manifest = JSON.parse(pluginEntries.get(`${PLUGIN_DIRECTORY}/.claude-plugin/plugin.json`));
  assert.equal(marketplace.name, MARKETPLACE_NAME);
  assert.deepEqual(marketplace.plugins.map(({ name, source, version }) => ({ name, source, version })), [
    { name: manifest.name, source: `./${PLUGIN_DIRECTORY}`, version: manifest.version },
  ]);
  assert.equal(
    JSON.parse(pluginEntries.get(`${PLUGIN_DIRECTORY}/.mcp.json`)).mcpServers.trackly.url,
    ENDPOINTS.claude,
  );
  assert.ok(pluginEntries.has(`${PLUGIN_DIRECTORY}/skills/trackly-apply/SKILL.md`));
});

test('archives store entries uncompressed so their bytes do not depend on zlib', () => {
  const archive = zip([{ name: 'a.txt', data: Buffer.from('hello hello hello hello') }]);
  assert.equal(archive.readUInt16LE(8), 0, 'local header method is stored');
  assert.ok(archive.includes(Buffer.from('hello hello hello hello')), 'file bytes appear verbatim');
  assert.deepEqual(readZip(archive), [{ name: 'a.txt', data: Buffer.from('hello hello hello hello') }]);
});

test('release workflow builds before releasing and uploads exactly the built downloads', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'auto-release.yml'), 'utf8');
  const build = workflow.indexOf('node scripts/build-claude-downloads.js --out dist/claude');
  const create = workflow.indexOf('gh release create');
  const upload = workflow.indexOf('gh release upload');
  assert.ok(build >= 0 && create > build && upload > create, 'build, then create, then upload');
  assert.match(workflow, /gh release view "\$TAG"/, 'release creation is idempotent so a rerun can attach');
  const [skill, plugin] = buildDownloads({ version: '$VERSION' });
  for (const filename of [skill.filename, plugin.filename, 'SHA256SUMS']) {
    assert.ok(workflow.includes(`dist/claude/${filename}`), `workflow uploads dist/claude/${filename}`);
  }
  assert.match(workflow, /--clobber/);
});

test('zip writer refuses unsafe or duplicate entries', () => {
  assert.throws(() => zip([{ name: '../x', data: Buffer.from('x') }]), /Unsafe archive entry/);
  assert.throws(() => zip([{ name: '/x', data: Buffer.from('x') }]), /Unsafe archive entry/);
  assert.throws(() => zip([{ name: 'a', data: Buffer.from('1') }, { name: 'a', data: Buffer.from('2') }]), /Duplicate archive entry/);
});

test('build script writes both downloads and a checksum file', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-claude-downloads-'));
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-claude-downloads.js'), '--out', out, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const { downloads } = JSON.parse(result.stdout);
    assert.deepEqual(downloads.map(({ kind }) => kind), ['claude_ai_skill', 'claude_code_plugin']);
    const sums = fs.readFileSync(path.join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(sums.length, 2);
    for (const { filename, sha256 } of downloads) {
      assert.ok(fs.existsSync(path.join(out, filename)));
      assert.ok(sums.includes(`${sha256}  ${filename}`));
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Claude Code validates the plugin and the packaged marketplace when its CLI is installed', (t) => {
  const probe = spawnSync('claude', ['plugin', 'validate', '--help'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('claude CLI with plugin validate is not installed');
    return;
  }
  const source = spawnSync('claude', ['plugin', 'validate', CLAUDE_PLUGIN, '--strict'], { encoding: 'utf8' });
  assert.equal(source.status, 0, source.stdout + source.stderr);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-claude-marketplace-'));
  try {
    const [, plugin] = buildDownloads({ version: '0.0.0' });
    for (const { name, data } of readZip(plugin.bytes)) {
      fs.mkdirSync(path.join(out, path.dirname(name)), { recursive: true });
      fs.writeFileSync(path.join(out, name), data);
    }
    const marketplace = spawnSync('claude', ['plugin', 'validate', path.join(out, 'trackly-claude-plugin-0.0.0'), '--strict'], { encoding: 'utf8' });
    assert.equal(marketplace.status, 0, marketplace.stdout + marketplace.stderr);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
