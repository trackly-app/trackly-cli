'use strict';

// Offline checks for the directory listing kits (ChatGPT 1.0.9 and Claude v2) and the
// Claude Trackly Apply skill and plugin. Run by `npm run test:plugin-submission` and
// by test/directory-kits.test.js. The catalogs in listing/*/tools.json are captured
// from close-ai's surface goldens; they are the authority these checks compare against.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function kitPaths(root = ROOT) {
  const claudePlugin = path.join(root, 'plugins', 'trackly-claude');
  return {
    root,
    listing: path.join(root, 'plugins', 'trackly', 'listing'),
    claudePlugin,
    claudeSkill: path.join(claudePlugin, 'skills', 'trackly-apply'),
  };
}
const { listing: LISTING, claudePlugin: CLAUDE_PLUGIN, claudeSkill: CLAUDE_SKILL } = kitPaths();
const ENDPOINTS = Object.freeze({
  openai: 'https://mcp.usetrackly.app/api/plugin/trackly/openai/mcp',
  claude: 'https://mcp.usetrackly.app/api/plugin/trackly/claude/mcp',
});
const OPENAI_NEW_TOOLS = Object.freeze([
  'trackly_get_application_profile', 'trackly_get_profile_onboarding', 'trackly_list_companies',
  'trackly_request_company', 'trackly_update_experience_limits', 'trackly_get_apply_queue',
  'trackly_list_tracker_applications', 'trackly_create_tracker_application', 'trackly_update_tracker_stage',
  'trackly_add_tracker_note', 'trackly_retract_tracker_event',
  // Trackly Apply (cloud), close-ai #3536: listed on the ChatGPT endpoint, so the 1.0.9 Rescan shows them too.
  'trackly_auto_apply', 'trackly_auto_apply_status',
]);
// Browser surfaces other directories accept; the Claude connector rejects them.
const NON_CLAUDE_SURFACES = Object.freeze(['codex_in_app', 'chrome_extension']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(path.join(directory, entry.name), relative);
    return entry.isFile() ? [relative] : [];
  });
}

/** Rows of the markdown tables in a document: tool name -> annotation-ish cells. */
function markdownToolRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\| `(trackly_[a-z_]+)` \|(.*)\|$/.exec(line);
    if (!match) continue;
    if (rows.has(match[1])) throw new Error(`${match[1]} appears in more than one table row`);
    rows.set(match[1], match[2].split('|').map((cell) => cell.trim()));
  }
  return rows;
}

function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!field) return null;
    fields[field[1]] = field[2];
  }
  return fields;
}

function catalogNames(catalog) {
  return catalog.tools.map(({ name }) => name);
}

function checkCatalog(check, catalog, surface, root) {
  check(catalog.formatVersion === 1, `${surface} tools.json formatVersion must be 1`);
  check(catalog.surface === surface, `${surface} tools.json must name surface ${surface}`);
  check(catalog.endpoint === ENDPOINTS[surface], `${surface} tools.json endpoint must be ${ENDPOINTS[surface]}`);
  check(/^[a-f0-9]{40}$/.test(catalog.source?.commit ?? ''), `${surface} tools.json must pin a full close-ai commit`);
  // A recapture moves the hosted fixture; the directory catalogs must be recaptured with it.
  const fixture = readJson(path.join(root, 'plugins', 'trackly', 'hosted-contract-fixture.json'));
  check(
    catalog.source?.commit === fixture.mergedRuntime?.commit,
    `${surface} tools.json must be captured from the same close-ai commit as hosted-contract-fixture.json`,
  );
  const names = catalogNames(catalog);
  check(new Set(names).size === names.length, `${surface} tools.json tool names must be unique`);
  for (const tool of catalog.tools) {
    check(/^trackly_[a-z_]+$/.test(tool.name), `${surface} tool name is not canonical: ${tool.name}`);
    check(Array.isArray(tool.scopes) && tool.scopes.length > 0, `${tool.name} must list its scopes`);
    check(!(tool.readOnlyHint && tool.destructiveHint), `${tool.name} cannot be read-only and destructive`);
  }
}

function checkOpenaiKit(check, { root: ROOT, listing: LISTING }) {
  const metadata = readJson(path.join(LISTING, 'openai', 'metadata.json'));
  const catalog = readJson(path.join(LISTING, 'openai', 'tools.json'));
  checkCatalog(check, catalog, 'openai', ROOT);
  const names = new Set(catalogNames(catalog));
  check(metadata.packageName === 'trackly-openai', 'OpenAI kit must describe the trackly-openai package');
  check(metadata.packageVersion === '1.0.9', 'OpenAI kit must describe package 1.0.9');
  check(metadata.appRecord === 'existing', 'OpenAI 1.0.9 must update the existing app record');
  check(metadata.productionMcpURL === ENDPOINTS.openai, 'OpenAI kit must point at the dedicated OpenAI MCP endpoint');
  check(metadata.sourcePackage?.commit === catalog.source?.commit, 'OpenAI kit metadata and catalog must come from the same close-ai commit');
  check(/^[a-f0-9]{64}$/.test(metadata.sourcePackage?.checksumManifestSha256 ?? ''), 'OpenAI kit must pin the package checksum manifest');
  check(metadata.toolCount === catalog.tools.length, `OpenAI kit toolCount must equal the ${catalog.tools.length}-tool catalog`);
  check(
    JSON.stringify(metadata.newTools) === JSON.stringify(OPENAI_NEW_TOOLS),
    'OpenAI kit newTools must be the thirteen additive 1.0.9 tools in order',
  );
  check(metadata.toolCount - metadata.newTools.length === metadata.unchangedToolCount, 'OpenAI kit tool counts must add up');
  for (const name of metadata.newTools) check(names.has(name), `OpenAI kit new tool is not in the catalog: ${name}`);
  const rows = markdownToolRows(fs.readFileSync(path.join(LISTING, 'openai', 'README.md'), 'utf8'));
  check(
    JSON.stringify([...rows.keys()].sort()) === JSON.stringify([...metadata.newTools].sort()),
    'OpenAI kit README must have exactly one justification row per new tool',
  );
  for (const [name, cells] of rows) {
    const tool = catalog.tools.find((candidate) => candidate.name === name);
    if (!tool) continue;
    check(cells[0] === String(tool.readOnlyHint), `OpenAI kit README read-only column is wrong for ${name}`);
    check(cells[1] === String(tool.destructiveHint), `OpenAI kit README destructive column is wrong for ${name}`);
    check(cells[3]?.length > 0, `OpenAI kit README needs a justification for ${name}`);
  }
}

function claudeAnnotation(tool) {
  if (tool.readOnlyHint) return 'read-only';
  return tool.destructiveHint ? 'destructive' : 'non-destructive';
}

function checkClaudeKit(check, { root: ROOT, listing: LISTING }) {
  const metadata = readJson(path.join(LISTING, 'claude', 'metadata.json'));
  const catalog = readJson(path.join(LISTING, 'claude', 'tools.json'));
  checkCatalog(check, catalog, 'claude', ROOT);
  check(metadata.productionMcpURL === ENDPOINTS.claude, 'Claude kit must point at the Claude connector endpoint');
  check(metadata.sourceCommit === catalog.source?.commit, 'Claude kit metadata and catalog must come from the same close-ai commit');
  check(metadata.browserSurface === 'claude_in_chrome', 'Claude kit browser surface must be claude_in_chrome');
  const allUsers = catalog.tools.filter(({ listedFor }) => listedFor === 'all_users');
  check(catalog.tools.every(({ listedFor }) => listedFor === 'all_users' || listedFor === 'apply_allowlist'),
    'every Claude tool must say who it is listed for');
  check(metadata.toolCount?.allUsers === allUsers.length, 'Claude kit allUsers count must match the catalog');
  check(metadata.toolCount?.applyAllowlisted === catalog.tools.length, 'Claude kit allowlisted count must match the catalog');
  check(
    catalog.tools.filter(({ listedFor }) => listedFor === 'apply_allowlist').every(({ group }) => group === 'apply'),
    'only the apply group may be allowlist-only on Claude',
  );
  check(Array.isArray(metadata.consentLines) && metadata.consentLines.length === 5, 'Claude kit must carry the five consent lines');
  check(fs.existsSync(path.join(ROOT, metadata.skill?.source ?? '', 'SKILL.md')), 'Claude kit skill source must exist');
  const rows = markdownToolRows(fs.readFileSync(path.join(LISTING, 'claude', 'README.md'), 'utf8'));
  check(
    JSON.stringify([...rows.keys()].sort()) === JSON.stringify(catalogNames(catalog).sort()),
    'Claude kit README tool table must list exactly the catalog',
  );
  for (const [name, cells] of rows) {
    const tool = catalog.tools.find((candidate) => candidate.name === name);
    if (!tool) continue;
    check(cells[1] === claudeAnnotation(tool), `Claude kit README annotation is wrong for ${name}`);
  }
}

function checkClaudePlugin(check, { claudePlugin: CLAUDE_PLUGIN }) {
  const manifest = readJson(path.join(CLAUDE_PLUGIN, '.claude-plugin', 'plugin.json'));
  check(manifest.name === 'trackly', 'Claude plugin name must be trackly');
  check(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ''), 'Claude plugin version must be semver');
  check(manifest.skills === './skills/', 'Claude plugin must load ./skills/');
  check(manifest.mcpServers === './.mcp.json', 'Claude plugin must load ./.mcp.json');
  check(manifest.privacyPolicyUrl === 'https://usetrackly.app/privacy', 'Claude plugin must declare the privacy policy');
  const mcp = readJson(path.join(CLAUDE_PLUGIN, '.mcp.json'));
  check(
    JSON.stringify(mcp) === JSON.stringify({ mcpServers: { trackly: { type: 'http', url: ENDPOINTS.claude } } }),
    'Claude plugin .mcp.json must declare exactly the Trackly Claude connector',
  );
}

function checkClaudeSkill(check, { listing: LISTING, claudeSkill: CLAUDE_SKILL }) {
  const catalog = readJson(path.join(LISTING, 'claude', 'tools.json'));
  const names = new Set(catalogNames(catalog));
  const skill = fs.readFileSync(path.join(CLAUDE_SKILL, 'SKILL.md'), 'utf8');
  const frontmatter = parseFrontmatter(skill);
  check(frontmatter !== null, 'Claude skill SKILL.md needs simple YAML frontmatter');
  if (frontmatter) {
    check(Object.keys(frontmatter).sort().join(',') === 'description,name', 'Claude skill frontmatter must have only name and description');
    check(frontmatter.name === 'trackly-apply' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name) && frontmatter.name.length <= 64,
      'Claude skill name must be trackly-apply');
    check(frontmatter.description.length > 0 && frontmatter.description.length <= 1024, 'Claude skill description must be 1 to 1024 characters');
    check(!/[<>]/.test(frontmatter.description), 'Claude skill description must not contain angle brackets');
  }
  for (const rule of [
    'Never activate the final Submit control.',
    'Attach only the exact resume the user approved for this exact application.',
    'Open only the frozen `navigation.requisitionUrl`',
    'Every `browserSurface` argument is the literal `claude_in_chrome`',
  ]) check(skill.includes(rule), `Claude skill must keep the rule: ${rule}`);
  for (const relative of listFiles(CLAUDE_SKILL)) {
    const text = fs.readFileSync(path.join(CLAUDE_SKILL, relative), 'utf8');
    for (const [token] of text.matchAll(/\btrackly_[a-z_]+\b/g)) {
      check(names.has(token), `Claude skill ${relative} names a tool the Claude connector does not list: ${token}`);
    }
    for (const surface of NON_CLAUDE_SURFACES) {
      check(!text.includes(surface), `Claude skill ${relative} must not use browser surface ${surface}`);
    }
    for (const [, value] of text.matchAll(/browserSurface[`]?:\s*`?([a-z_]+)/g)) {
      check(value === 'claude_in_chrome', `Claude skill ${relative} sets browserSurface to ${value}`);
    }
    for (const line of text.split('\n').filter((candidate) => candidate.includes('trackly_approve_apply_resume'))) {
      check(/\bnever\b/i.test(line), `Claude skill ${relative} may mention trackly_approve_apply_resume only to forbid it`);
    }
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^https:\/\//.test(target)) continue;
      // Links must stay inside the packaged skill folder, or the downloaded skill breaks.
      const resolved = path.resolve(CLAUDE_SKILL, path.dirname(relative), target);
      if (!resolved.startsWith(`${CLAUDE_SKILL}${path.sep}`)) {
        check(false, `Claude skill ${relative} links outside the skill folder: ${target}`);
        continue;
      }
      check(fs.existsSync(resolved), `Claude skill ${relative} links to a missing file: ${target}`);
    }
    check(!/\bhttp:\/\//.test(text), `Claude skill ${relative} must use HTTPS links`);
  }
}

function verifyDirectoryKits({ root = ROOT } = {}) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const paths = kitPaths(root);
  for (const run of [checkOpenaiKit, checkClaudeKit, checkClaudePlugin, checkClaudeSkill]) {
    try {
      run(check, paths);
    } catch (error) {
      errors.push(`${run.name}: ${error.message}`);
    }
  }
  return errors;
}

if (require.main === module) {
  const errors = verifyDirectoryKits();
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.log(errors.length === 0 ? 'Directory kits pass.' : `Directory kits failed with ${errors.length} error(s).`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

module.exports = {
  CLAUDE_PLUGIN,
  CLAUDE_SKILL,
  ENDPOINTS,
  LISTING,
  kitPaths,
  markdownToolRows,
  parseFrontmatter,
  verifyDirectoryKits,
};
