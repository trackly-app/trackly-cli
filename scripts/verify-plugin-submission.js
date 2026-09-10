#!/usr/bin/env node
'use strict';

/**
 * Offline and optional live preflight for the Trackly OpenAI plugin package.
 *
 * The OpenAI submission portal is the authority, but this command catches the
 * inexpensive failures before a draft is created.  By default it performs no
 * network requests and never reads credentials.  Pass --live after deploying
 * the production MCP facade to exercise public discovery and the unauthenticated
 * challenge contract.  A credentialed OAuth run still belongs in the portal's
 * clean-browser gate and is intentionally not automated here.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URL } = require('node:url');
const { StringDecoder } = require('node:string_decoder');
const YAML = require('yaml');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const zlib = require('node:zlib');
const sharp = require('sharp');
const { SaxesParser } = require('saxes');
const { TextDecoder } = require('node:util');
const { OAuthMetadataSchema, OAuthProtectedResourceMetadataSchema } = require('@modelcontextprotocol/sdk/shared/auth.js');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'trackly');
const MANIFEST_PATH = path.join(PLUGIN, '.codex-plugin', 'plugin.json');
const METADATA_PATH = path.join(PLUGIN, 'listing', 'metadata.json');
const TESTS_PATH = path.join(PLUGIN, 'listing', 'submission-tests.json');
const EXPECTED_PORTAL_POSITIVE_IDS = Object.freeze([
  'search-recent-product',
  'search-monitored-remote',
  'job-brief',
  'apply-to-review',
  'reconcile-manual-submission',
]);
const REQUIRED_URL_KEYS = Object.freeze([
  'websiteURL',
  'privacyPolicyURL',
  'termsOfServiceURL',
]);
const SUPPORTED_CATEGORIES = new Set([
  'Productivity',
  'Creativity',
  'Developer Tools',
  'Business & Operations',
  'Data & Analytics',
  'Communication',
  'Education & Research',
  'Security',
  'Finance',
  'Healthcare',
  'Travel',
  'Entertainment',
  'Other',
]);
const DEFAULT_MCP_URL = 'https://mcp.usetrackly.app/api/plugin/trackly/mcp';
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UNSUPPORTED_TEXT_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const PUBLIC_TRIAL_WORD_RE = /\b(?:trial|demo|beta|pilot)\b/i;
const OFFICIAL_CLIENT_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://codex.openai.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
]);
const ALLOWED_MANIFEST_KEYS = new Set([
  'id',
  'name',
  'version',
  'description',
  'skills',
  'apps',
  'mcpServers',
  'interface',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
]);
const ALLOWED_INTERFACE_KEYS = new Set([
  'displayName',
  'shortDescription',
  'longDescription',
  'developerName',
  'category',
  'capabilities',
  'websiteURL',
  'privacyPolicyURL',
  'termsOfServiceURL',
  'brandColor',
  'composerIcon',
  'logo',
  'logoDark',
  'screenshots',
  'defaultPrompt',
  'default_prompt',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(state, message) {
  state.errors.push(message);
}

function addWarning(state, message) {
  state.warnings.push(message);
}

function check(state, condition, message) {
  if (!condition) addError(state, message);
}

function firstUnsupportedCodePoint(value) {
  for (const character of value) {
    if (UNSUPPORTED_TEXT_RE.test(character)) {
      return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return null;
}

function checkSupportedText(state, value, label) {
  if (typeof value !== 'string') return;
  const codePoint = firstUnsupportedCodePoint(value);
  if (codePoint) addError(state, `${label} contains unsupported control/invisible text (${codePoint})`);
}

function normalizePrompt(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function checkUniqueNormalizedStrings(state, values, label) {
  const seen = new Map();
  values.forEach((value, index) => {
    if (typeof value !== 'string') return;
    const normalized = normalizePrompt(value);
    if (!normalized) return;
    const previous = seen.get(normalized);
    if (previous !== undefined) {
      addError(state, `${label}[${index}] duplicates ${label}[${previous}] after Unicode/whitespace normalization`);
    } else {
      seen.set(normalized, index);
    }
  });
}

function rejectUnknownKeys(state, value, allowed, label) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) addError(state, `${label}.${key} is not accepted by the plugin manifest schema`);
  }
}

function checkString(state, value, label, { max = Infinity, oneLine = false, allowNewlines = false } = {}) {
  check(state, typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`);
  if (typeof value !== 'string') return;
  checkSupportedText(state, allowNewlines ? value.replace(/\r\n?|\n/g, '') : value, label);
  check(state, value.length <= max, `${label} must be ${max} characters or fewer (got ${value.length})`);
  if (oneLine) check(state, !/[\r\n]/.test(value), `${label} must be one line`);
}

function validateHttpsUrl(state, value, label, { max = 1024 } = {}) {
  checkString(state, value, label, { max });
  if (typeof value !== 'string') return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addError(state, `${label} must be a valid HTTPS URL`);
    return;
  }
  check(state, /^https:\/\/[^/\\\s?#]/i.test(value) && parsed.protocol === 'https:', `${label} must use an absolute HTTPS URL`);
  check(state, parsed.username === '' && parsed.password === '', `${label} must not contain URL credentials`);
}

function validateManifest(state, manifest, metadata) {
  check(state, isObject(manifest), 'plugin manifest must be a JSON object');
  if (!isObject(manifest)) return;
  rejectUnknownKeys(state, manifest, ALLOWED_MANIFEST_KEYS, 'manifest');
  check(state, !/\[TODO[: ]/i.test(JSON.stringify(manifest)), 'manifest must not contain TODO placeholders');
  if (Object.hasOwn(manifest, 'id')) checkString(state, manifest.id, 'manifest.id');
  checkString(state, manifest.name, 'manifest.name', { max: 64, oneLine: true });
  check(state, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name || ''), 'manifest.name must use lowercase kebab-case');
  check(state, manifest.name === path.basename(PLUGIN), 'manifest.name must match the plugin directory name');
  check(state, STRICT_SEMVER.test(manifest.version || ''), 'manifest.version must be strict semantic versioning');
  checkString(state, manifest.version, 'manifest.version', { max: 64, oneLine: true });
  checkString(state, manifest.description, 'manifest.description', { max: 1024 });
  check(state, !PUBLIC_TRIAL_WORD_RE.test(manifest.description || ''), 'manifest.description must not describe a trial, demo, beta, or pilot');
  check(state, isObject(manifest.author), 'manifest.author must be an object');
  if (isObject(manifest.author)) {
    rejectUnknownKeys(state, manifest.author, new Set(['name', 'email', 'url']), 'manifest.author');
    checkString(state, manifest.author.name, 'manifest.author.name', { max: 120, oneLine: true });
    if (manifest.author.email !== undefined) checkString(state, manifest.author.email, 'manifest.author.email', { max: 320, oneLine: true });
    if (manifest.author.url !== undefined) validateHttpsUrl(state, manifest.author.url, 'manifest.author.url', { max: 2048 });
  }

  const iface = manifest.interface;
  check(state, isObject(iface), 'manifest.interface must be an object');
  if (!isObject(iface)) return;
  check(state, iface.websiteURL === 'https://usetrackly.app/plugins/trackly', 'interface.websiteURL must be the reviewed Trackly plugin listing URL');
  rejectUnknownKeys(state, iface, ALLOWED_INTERFACE_KEYS, 'manifest.interface');
  checkString(state, iface.displayName, 'interface.displayName', { max: 30, oneLine: true });
  checkString(state, iface.shortDescription, 'interface.shortDescription', { max: 30, oneLine: true });
  check(state, !PUBLIC_TRIAL_WORD_RE.test(iface.displayName || ''), 'interface.displayName must not describe a trial, demo, beta, or pilot');
  check(state, !PUBLIC_TRIAL_WORD_RE.test(iface.shortDescription || ''), 'interface.shortDescription must not describe a trial, demo, beta, or pilot');
  checkString(state, iface.longDescription, 'interface.longDescription', { max: 4000, allowNewlines: true });
  check(state, !PUBLIC_TRIAL_WORD_RE.test(iface.longDescription || ''), 'interface.longDescription must describe the production service, not a trial/demo/pilot');
  checkString(state, iface.developerName, 'interface.developerName', { max: 80, oneLine: true });
  check(state, iface.developerName === manifest.author?.name, 'interface.developerName must match author.name');
  check(state, SUPPORTED_CATEGORIES.has(iface.category), `interface.category is unsupported: ${iface.category}`);
  check(state, Array.isArray(iface.capabilities), 'interface.capabilities must be an array');
  if (Array.isArray(iface.capabilities)) {
    check(state, iface.capabilities.length <= 20, 'interface.capabilities must contain at most 20 entries');
    iface.capabilities.forEach((item, index) => checkString(state, item, `interface.capabilities[${index}]`, { max: 120, oneLine: true }));
    checkUniqueNormalizedStrings(state, iface.capabilities, 'interface.capabilities');
  }
  const promptFields = ['defaultPrompt', 'default_prompt'].filter(key => Object.hasOwn(iface, key));
  check(state, promptFields.length > 0, 'interface.defaultPrompt or default_prompt is required');
  for (const key of promptFields) {
    const prompts = typeof iface[key] === 'string' ? [iface[key]] : iface[key];
    check(state, Array.isArray(prompts), `interface.${key} must be a string or array`);
    if (!Array.isArray(prompts)) continue;
    check(state, prompts.length <= 3, `interface.${key} must contain at most 3 prompts`);
    checkUniqueNormalizedStrings(state, prompts, `interface.${key}`);
    prompts.forEach((item, index) => {
      checkString(state, item, `interface.${key}[${index}]`, { max: 128, oneLine: true });
      check(state, !/@[A-Za-z0-9_-]+/.test(item || ''), `interface.${key}[${index}] must not contain an app mention`);
    });
  }
  if (promptFields.length === 2) {
    const normalize = value => (Array.isArray(value) ? value : [value]).map(normalizePrompt);
    check(state, JSON.stringify(normalize(iface.defaultPrompt)) === JSON.stringify(normalize(iface.default_prompt)), 'interface.defaultPrompt and default_prompt must agree when both are present');
  }
  for (const key of REQUIRED_URL_KEYS) validateHttpsUrl(state, iface[key], `interface.${key}`);
  for (const key of ['privacyPolicyURL', 'termsOfServiceURL']) {
    check(state, iface[key] === metadata?.[key], `interface.${key} and listing.${key} must match`);
  }
  check(state, iface.brandColor === undefined || /^#[0-9A-Fa-f]{6}$/.test(iface.brandColor), 'interface.brandColor must be a six-digit hex color');

  check(state, manifest.skills === './skills/', 'manifest.skills must point to ./skills/');
  check(state, manifest.mcpServers === './.mcp.json', 'manifest.mcpServers must point to ./.mcp.json');
  check(state, !Object.hasOwn(manifest, 'apps'), 'manifest must not bind a developer-mode apps ID');
  check(state, !fs.existsSync(path.join(PLUGIN, '.app.json')), '.app.json must not be packaged for a With MCP submission');
  check(state, manifest.name === metadata?.pluginName, 'manifest.name and listing metadata pluginName must match');
  check(state, manifest.description === metadata?.shortDescription, 'manifest.description and listing shortDescription must match');
  check(state, iface.shortDescription === metadata?.shortDescription, 'interface.shortDescription and listing shortDescription must match');
}

function validateMetadata(state, metadata) {
  check(state, isObject(metadata), 'listing metadata must be a JSON object');
  if (!isObject(metadata)) return;
  checkString(state, metadata.pluginName, 'listing.pluginName', { max: 64, oneLine: true });
  checkString(state, metadata.shortDescription, 'listing.shortDescription', { max: 30, oneLine: true });
  checkString(state, metadata.tagline, 'listing.tagline', { max: 120, oneLine: true });
  checkString(state, metadata.audience, 'listing.audience', { max: 120, oneLine: true });
  check(state, metadata.audience === 'US job seekers', 'listing.audience must remain US job seekers');
  validateHttpsUrl(state, metadata.supportURL, 'listing.supportURL');
  check(state, metadata.supportURL === 'https://usetrackly.app/support', 'listing.supportURL must be the reviewed Trackly support page');
  validateHttpsUrl(state, metadata.privacyPolicyURL, 'listing.privacyPolicyURL');
  validateHttpsUrl(state, metadata.termsOfServiceURL, 'listing.termsOfServiceURL');
  validateHttpsUrl(state, metadata.productionMcpURL, 'listing.productionMcpURL');
  check(state, metadata.productionMcpURL === DEFAULT_MCP_URL, 'listing.productionMcpURL must be the dedicated plugin facade URL');
  checkString(state, metadata.pricingClaim, 'listing.pricingClaim', { max: 120, oneLine: true });
  checkString(state, metadata.submissionBoundary, 'listing.submissionBoundary', { max: 4000 });
  check(state, metadata.accountRequired === true, 'listing.accountRequired must be true for the authenticated plugin');
  check(state, metadata.pricingClaim === 'Free', 'listing.pricingClaim must match the public free-service claim');
  check(state, !PUBLIC_TRIAL_WORD_RE.test(metadata.tagline || ''), 'listing.tagline must not describe a trial, demo, beta, or pilot');
  check(state, !PUBLIC_TRIAL_WORD_RE.test(metadata.pricingClaim || ''), 'listing.pricingClaim must not describe a trial, demo, beta, or pilot');
  check(state, !PUBLIC_TRIAL_WORD_RE.test(metadata.submissionBoundary || ''), 'listing.submissionBoundary must not describe a trial, demo, beta, or pilot');
  // Pin the reviewed safety copy; keyword matching cannot validate arbitrary
  // natural-language negation or distinguish the user from an agent submitter.
  check(state, normalizePrompt(metadata.submissionBoundary) === 'The user reviews and submits every application manually.',
    'listing.submissionBoundary must retain the reviewed user-controlled manual submission statement');
}

function validateMcpConfig(state, metadata) {
  const configPath = path.join(PLUGIN, '.mcp.json');
  let config;
  try {
    config = readJson(configPath);
  } catch (error) {
    addError(state, `could not read .mcp.json: ${error.message}`);
    return;
  }
  rejectUnknownKeys(state, config, new Set(['mcpServers']), '.mcp.json');
  check(state, isObject(config?.mcpServers), '.mcp.json must contain mcpServers');
  if (!isObject(config?.mcpServers)) return;
  check(state, Object.keys(config.mcpServers).length === 1 && Object.hasOwn(config.mcpServers, 'trackly'), '.mcp.json must contain only the trackly server');
  const server = config.mcpServers.trackly;
  check(state, isObject(server), '.mcp.json trackly entry must be an object');
  if (!isObject(server)) return;
  rejectUnknownKeys(state, server, new Set(['type', 'url']), '.mcp.json trackly');
  check(state, server.type === 'http', '.mcp.json trackly transport must be HTTP');
  check(state, server.url === metadata?.productionMcpURL, '.mcp.json URL must match listing.productionMcpURL');
  check(state, !Object.hasOwn(server, 'oauth_resource'), '.mcp.json must not duplicate the OAuth resource parameter');
}

function parseYaml(source) {
  const document = YAML.parseDocument(source, { version: '1.1', uniqueKeys: true, prettyErrors: false, logLevel: 'silent' });
  if (document.errors.length || document.warnings.length) throw new Error('invalid YAML');
  return document.toJS({ maxAliasCount: 100 });
}

async function validateSkillAgent(state, skillRoot, name) {
  const file = path.join(skillRoot, 'agents', 'openai.yaml');
  if (!fs.existsSync(file)) return;
  const label = `skill ${name} agent`;
  let payload;
  try { payload = parseYaml(fs.readFileSync(file, 'utf8')); }
  catch { addError(state, `${label} must contain valid YAML`); return; }
  check(state, isObject(payload), `${label} must be an object`);
  if (!isObject(payload)) return;
  rejectUnknownKeys(state, payload, new Set(['interface', 'policy', 'dependencies']), label);
  const iface = payload.interface;
  check(state, isObject(iface), `${label}.interface must be an object`);
  if (isObject(iface)) {
    rejectUnknownKeys(state, iface, new Set(['display_name', 'short_description', 'icon_small', 'icon_large', 'brand_color', 'default_prompt']), `${label}.interface`);
    for (const key of ['display_name', 'short_description']) checkString(state, iface[key], `${label}.interface.${key}`);
    if (iface.default_prompt !== undefined) checkString(state, iface.default_prompt, `${label}.interface.default_prompt`);
    if (iface.brand_color !== undefined) check(state, typeof iface.brand_color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(iface.brand_color), `${label}.interface.brand_color must be a six-digit hex color`);
    for (const key of ['icon_small', 'icon_large']) {
      if (iface[key] === undefined) continue;
      const relative = iface[key];
      const valid = typeof relative === 'string' && relative.trim() && !path.isAbsolute(relative)
        && !relative.replace(/\\/g, '/').split('/').includes('..');
      check(state, Boolean(valid), `${label}.interface.${key} must be a safe relative asset path`);
      if (!valid) continue;
      const resolved = path.resolve(skillRoot, relative.replace(/\\/g, '/'));
      const contained = resolved.startsWith(`${PLUGIN}${path.sep}`);
      check(state, contained, `${label}.interface.${key} must stay inside the plugin`);
      if (contained) {
        const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
        check(state, exists, `${label}.interface.${key} must reference an existing file`);
        if (exists) await validateBranding(state, resolved, `${label}.interface.${key}`, { square: false, minimum: 1 });
      }
    }
  }
  for (const [key, allowed] of [['policy', ['allow_implicit_invocation']], ['dependencies', ['tools']]]) {
    if (payload[key] === undefined) continue;
    check(state, isObject(payload[key]), `${label}.${key} must be an object`);
    if (isObject(payload[key])) rejectUnknownKeys(state, payload[key], new Set(allowed), `${label}.${key}`);
  }
  if (isObject(payload.policy) && payload.policy.allow_implicit_invocation !== undefined) {
    check(state, typeof payload.policy.allow_implicit_invocation === 'boolean', `${label}.policy.allow_implicit_invocation must be boolean`);
  }
  if (isObject(payload.dependencies) && payload.dependencies.tools !== undefined) {
    const tools = payload.dependencies.tools;
    check(state, Array.isArray(tools), `${label}.dependencies.tools must be an array`);
    if (Array.isArray(tools)) for (const [index, tool] of tools.entries()) {
      const toolLabel = `${label}.dependencies.tools[${index}]`;
      check(state, isObject(tool), `${toolLabel} must be an object`);
      if (!isObject(tool)) continue;
      rejectUnknownKeys(state, tool, new Set(['type', 'value', 'description', 'transport', 'url']), toolLabel);
      check(state, tool.type === 'mcp', `${toolLabel}.type must be mcp`);
      checkString(state, tool.value, `${toolLabel}.value`);
      check(state, tool.value === 'trackly', `${toolLabel}.value must be trackly`);
      checkString(state, tool.description, `${toolLabel}.description`);
      check(state, tool.transport === 'streamable_http', `${toolLabel}.transport must be streamable_http`);
      validateHttpsUrl(state, tool.url, `${toolLabel}.url`);
      check(state, tool.url === 'https://mcp.usetrackly.app/api/plugin/trackly/mcp', `${toolLabel}.url must be the reviewed Trackly MCP facade`);
    }
  }
}

async function validateSkills(state) {
  const skillsPath = path.join(PLUGIN, 'skills');
  check(state, fs.existsSync(skillsPath) && fs.statSync(skillsPath).isDirectory(), 'skills/ must exist');
  if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) return;
  const entries = fs.readdirSync(skillsPath, { withFileTypes: true });
  check(state, entries.some((entry) => entry.isDirectory() && !entry.name.startsWith('.')), 'skills/ must contain at least one skill');
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillPath = path.join(skillsPath, entry.name, 'SKILL.md');
    check(state, fs.existsSync(skillPath), `skill ${entry.name} must contain SKILL.md`);
    if (!fs.existsSync(skillPath)) continue;
    const source = fs.readFileSync(skillPath, 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    check(state, Boolean(match), `skill ${entry.name} must begin with YAML frontmatter`);
    if (!match) continue;
    const frontmatter = match[1];
    let parsed;
    try {
      parsed = parseYaml(frontmatter);
    } catch {
      addError(state, `skill ${entry.name} frontmatter must be valid YAML`);
      continue;
    }
    check(state, isObject(parsed), `skill ${entry.name} frontmatter must be a YAML mapping`);
    for (const key of ['disable-model-invocation', 'disable_model_invocation']) {
      if (isObject(parsed) && Object.hasOwn(parsed, key)) check(state, parsed[key] === false, `skill ${entry.name} frontmatter ${key} must be false when present`);
    }
    const name = isObject(parsed) ? parsed.name : undefined;
    const description = isObject(parsed) ? parsed.description : undefined;
    checkString(state, name, `skill ${entry.name} frontmatter name`, { max: 64, oneLine: true });
    checkString(state, description, `skill ${entry.name} frontmatter description`, { max: 1024, allowNewlines: true });
    check(state, !/\[TODO[: ]/i.test(frontmatter), `skill ${entry.name} frontmatter must not contain TODO placeholders`);
    await validateSkillAgent(state, path.join(skillsPath, entry.name), entry.name);
  }
}

function containsCredentialAssignment(file) {
  const names = ['MCP_REVIEW_LOGIN_PASSWORD', 'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_ACCESS_TOKEN', 'OPENAI_API_KEY', '_authToken', '_auth', '_password', 'Authorization', 'authorization', 'access_token'];
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let prefix = '';
  let phase = 'name';
  let quote;
  let matchedName = '';
  let boundary = true;
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      for (const char of decoder.write(buffer.subarray(0, bytes))) {
        if (phase === 'equals' && names.some(name => name.startsWith(matchedName + char))) {
          phase = 'name';
          prefix = matchedName;
        }
        const whitespace = /\s/.test(char);
        if ((phase === 'equals' || phase === 'delimiter') && whitespace) { boundary = true; continue; }
        if (phase === 'equals' && (char === '"' || char === "'")) { phase = 'delimiter'; continue; }
        if ((phase === 'equals' || phase === 'delimiter') && (char === '=' || char === ':')) { phase = 'value'; continue; }
        if (phase === 'value' && whitespace) continue;
        if (phase === 'quoted' && char !== quote) return true;
        if (phase === 'value') {
          if (char !== '"' && char !== "'") return true;
          quote = char; phase = 'quoted'; continue;
        }
        if (phase !== 'name') { phase = 'name'; prefix = ''; }
        if (prefix || boundary) {
          prefix += char;
          if (names.includes(prefix)) { matchedName = prefix; phase = 'equals'; prefix = ''; }
          else if (!names.some((name) => name.startsWith(prefix))) prefix = '';
        }
        boundary = !/[\p{ID_Continue}$]/u.test(char);
      }
    }
    return false;
  } finally { fs.closeSync(fd); }
}

function validateScreenshot(state, file, relative) {
  const extension = path.extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
    addError(state, `${relative} screenshot must be PNG or JPEG`);
    return;
  }
  // Reuse the archive's per-file admission limit before allocating input bytes.
  if (fs.statSync(file).size > 100 * 1024 * 1024) return;
  try {
    const data = fs.readFileSync(file);
    let decoded;
    if (extension === '.png') {
      if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('invalid PNG');
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      if (width !== 706 || height < 400 || height > 860) throw new Error('invalid dimensions');
      // pngjs accepts repeated IHDR chunks; reject them before a later header
      // can replace the bounded dimensions used for decompression.
      let offset = 8;
      const compressed = [];
      while (offset < data.length) {
        if (data.length - offset < 12) throw new Error('truncated PNG chunk');
        const length = data.readUInt32BE(offset);
        if (length > data.length - offset - 12) throw new Error('truncated PNG chunk');
        if (offset !== 8 && data.toString('ascii', offset + 4, offset + 8) === 'IHDR') throw new Error('duplicate PNG header');
        if (data.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(data.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      // pngjs bounds non-interlaced inflation, but its interlaced path does
      // not. Verify that output is bounded before entering that decoder path.
      // 8 MiB exceeds the maximum legal scanlines at these dimensions/depths.
      if (data[28] === 1) zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: 8 * 1024 * 1024 });
      decoded = PNG.sync.read(data, { checkCRC: true });
    } else {
      if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error('invalid JPEG');
      decoded = jpeg.decode(data, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 32 });
    }
    check(state, decoded.width === 706 && decoded.height >= 400 && decoded.height <= 860,
      `${relative} screenshot must be 706 pixels wide and 400–860 pixels high`);
  } catch {
    addError(state, `${relative} screenshot must be a valid PNG or JPEG, 706 pixels wide and 400–860 pixels high`);
  }
}

async function validateBranding(state, file, relative, { square = true, minimum = 48 } = {}) {
  const extension = path.extname(file).toLowerCase();
  if (!['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    addError(state, `${relative} branding must be SVG, PNG, JPEG or WebP`);
    return;
  }
  if (fs.statSync(file).size > 5 * 1024 * 1024) {
    addError(state, `${relative} branding must not exceed 5 MiB`);
    return;
  }
  try {
    const data = fs.readFileSync(file);
    if (extension === '.svg') {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
      let root;
      const parser = new SaxesParser({ xmlns: true });
      parser.on('opentag', tag => { if (!root) root = tag; });
      parser.write(source).close();
      if (!root || root.local !== 'svg' || (root.uri && root.uri !== 'http://www.w3.org/2000/svg')) throw new Error('invalid SVG root');
      const attribute = name => root.attributes[name]?.value;
      const numeric = value => typeof value === 'string' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value));
      const pixels = value => typeof value === 'string' ? value.trim().replace(/px$/, '') : value;
      const viewBox = attribute('viewBox');
      if (viewBox !== undefined && (attribute('width') !== undefined || attribute('height') !== undefined)) {
        const intrinsicWidth = pixels(attribute('width')); const intrinsicHeight = pixels(attribute('height'));
        if (!numeric(intrinsicWidth) || !numeric(intrinsicHeight)
          || Number(intrinsicWidth) < minimum || Number(intrinsicHeight) < minimum
          || (square && Number(intrinsicWidth) !== Number(intrinsicHeight))) throw new Error('invalid SVG viewport dimensions');
      }
      let width; let height;
      if (viewBox !== undefined) {
        const dimensions = viewBox.trim().split(/[\s,]+/);
        if (dimensions.length !== 4 || !dimensions.every(numeric)) throw new Error('invalid SVG dimensions');
        width = Number(dimensions[2]); height = Number(dimensions[3]);
      } else {
        if (!numeric(pixels(attribute('width'))) || !numeric(pixels(attribute('height')))) throw new Error('missing SVG dimensions');
        width = Number(pixels(attribute('width'))); height = Number(pixels(attribute('height')));
      }
      check(state, (!square || width === height) && width >= minimum && height >= minimum,
        `${relative} must declare ${square ? 'square ' : ''}SVG dimensions of at least ${minimum} pixels`);
      return;
    }
    const expected = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension.slice(1);
    const signatureMatches = expected === 'png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : expected === 'jpeg' ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    if (!signatureMatches) throw new Error('branding format mismatch');
    const decoder = sharp(data, { failOn: 'warning', limitInputPixels: 4096 * 4096 }).timeout({ seconds: 10 });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected || (square && metadata.width !== metadata.height)
      || metadata.width < minimum || metadata.height < minimum || metadata.width > 4096 || metadata.height > 4096) throw new Error('invalid raster branding');
    await decoder.raw().toBuffer();
  } catch {
    addError(state, `${relative} branding must decode in its declared format; raster dimensions must be ${square ? 'square and ' : ''}${minimum}–4096 pixels, SVG must be valid XML`);
  }
}

async function validateAssetsAndTree(state, manifest = readJson(MANIFEST_PATH)) {
  const referenced = [manifest?.interface?.composerIcon, manifest?.interface?.logo, manifest?.interface?.logoDark]
    .map(relative => ({ relative, branding: true }));
  const screenshots = manifest?.interface?.screenshots;
  if (screenshots !== undefined) {
    check(state, Array.isArray(screenshots), 'interface.screenshots must be an array');
    if (Array.isArray(screenshots) && screenshots.length > 0) {
      const prompts = manifest?.interface?.defaultPrompt ?? manifest?.interface?.default_prompt;
      const count = typeof prompts === 'string' ? 1 : Array.isArray(prompts) ? prompts.length : 0;
      check(state, screenshots.length === count, 'interface.screenshots must contain one screenshot per starter prompt');
    }
    if (Array.isArray(screenshots)) referenced.push(...screenshots.map(relative => ({ relative, branding: false })));
  }
  for (const { relative, branding } of referenced) {
    check(state, typeof relative === 'string' && relative.startsWith('./'), `asset reference must be relative: ${relative}`);
    if (typeof relative !== 'string') continue;
    if (relative.replace(/\\/g, '/').split('/').includes('..')) {
      addError(state, `asset reference must not contain parent segments: ${relative}`);
      continue;
    }
    const resolved = path.resolve(PLUGIN, relative);
    const contained = resolved.startsWith(`${PLUGIN}${path.sep}`);
    check(state, contained, `asset reference escapes plugin root: ${relative}`);
    if (!contained) continue;
    check(state, fs.existsSync(resolved) && fs.statSync(resolved).isFile(), `referenced asset is missing: ${relative}`);
    if (!branding && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) validateScreenshot(state, resolved, relative);
    if (branding && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) await validateBranding(state, resolved, relative);
  }

  let count = 0;
  let totalBytes = 0;
  function walk(directory, relativePrefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const segments = relative.split('/');
      check(state, !segments.includes('') && !segments.includes('.') && !segments.includes('..'), `unsafe plugin path: ${relative}`);
      if (segments.length > 20) {
        addError(state, `plugin path is too deep: ${relative}`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        count += 1;
        const size = fs.statSync(absolute).size;
        totalBytes += size;
        check(state, size <= 100 * 1024 * 1024, `plugin file exceeds 100 MiB: ${relative}`);
        check(state, !/^\.env(?:\.|$)/i.test(entry.name), `environment file must not be packaged: ${relative}`);
        if (size > 100 * 1024 * 1024) continue;
        check(state, !containsCredentialAssignment(absolute), `credential assignment found in plugin file: ${relative}`);
      } else {
        addError(state, `plugin archive contains unsupported entry type: ${relative}`);
      }
    }
  }
  walk(PLUGIN);
  check(state, count <= 5000, `plugin contains too many files (${count})`);
  check(state, totalBytes <= 512 * 1024 * 1024, `plugin tree exceeds 512 MiB (${totalBytes} bytes)`);
}

function validateSubmissionTests(state, fixtures) {
  check(state, isObject(fixtures), 'submission-tests must be a JSON object');
  if (!isObject(fixtures)) return;
  check(state, Array.isArray(fixtures.positive) && fixtures.positive.length === 6, 'submission fixtures must contain six internal positive cases');
  check(state, Array.isArray(fixtures.negative) && fixtures.negative.length === 3, 'submission fixtures must contain three negative cases');
  const positive = Array.isArray(fixtures.positive) ? fixtures.positive : [];
  const negative = Array.isArray(fixtures.negative) ? fixtures.negative : [];
  const allIds = [...positive, ...negative].map((item) => item?.id);
  allIds.forEach((id, index) => checkString(state, id, `submission fixture[${index}].id`));
  check(state, new Set(allIds).size === allIds.length, 'submission fixture IDs must be unique');
  check(state, Array.isArray(fixtures.reviewEnvironment?.portalPositiveCaseIds), 'reviewEnvironment.portalPositiveCaseIds must be an array');
  check(state, JSON.stringify(fixtures.reviewEnvironment?.portalPositiveCaseIds) === JSON.stringify(EXPECTED_PORTAL_POSITIVE_IDS), 'portal positive case IDs must remain the exact five-case sequence');
  const briefs = fixtures.reviewEnvironment?.portalCaseBriefs;
  check(state, Array.isArray(briefs) && briefs.length === 8, 'reviewEnvironment.portalCaseBriefs must contain exactly eight reviewer cases');
  if (Array.isArray(briefs)) {
    const expectedBriefIds = [...EXPECTED_PORTAL_POSITIVE_IDS, ...negative.map((item) => item?.id)];
    check(state, JSON.stringify(briefs.map((item) => item?.id)) === JSON.stringify(expectedBriefIds), 'portal briefs must cover five positives followed by three negatives');
    checkUniqueNormalizedStrings(state, briefs.map((item) => item?.prompt), 'reviewEnvironment.portalCaseBriefs.prompt');
    for (const brief of briefs) {
      const fixture = [...positive, ...negative].find(item => item?.id === brief?.id);
      const prompt = fixture?.prompt || (Array.isArray(fixture?.turns) ? fixture.turns.find(turn => turn?.role === 'user')?.content : undefined);
      check(state, typeof prompt === 'string' && typeof brief?.prompt === 'string' && normalizePrompt(brief.prompt) === normalizePrompt(prompt),
        `portal brief ${brief?.id || '<unknown>'}.prompt must match its fixture prompt or first user turn`);
      for (const key of ['id', 'prompt', 'fixtureData', 'expectedWorkflow', 'expectedResult']) {
        checkString(state, brief?.[key], `portal brief ${brief?.id || '<unknown>'}.${key}`);
      }
      if (brief?.safetyBoundary !== undefined) checkString(state, brief.safetyBoundary, `portal brief ${brief?.id || '<unknown>'}.safetyBoundary`);
      if (String(brief?.id).startsWith('no-')) checkString(state, brief?.whyOutOfScope, `portal brief ${brief.id}.whyOutOfScope`);
    }
  }
  for (const item of positive) {
    checkString(state, item?.fixture, `${item?.id || '<unknown>'}.fixture`);
    check(state, Array.isArray(item?.mustNot) && item.mustNot.length > 0
      && item.mustNot.every(value => typeof value === 'string' && value.trim()),
    `${item?.id || '<unknown>'}.mustNot must be a non-empty string array`);
    for (const key of ['expected', 'expectedResultShape']) {
      check(state, Array.isArray(item?.[key]) && item[key].length > 0
        && item[key].every(value => typeof value === 'string' && value.trim()),
      `${item?.id || '<unknown>'}.${key} must be a non-empty string array`);
    }
    if (item?.prompt !== undefined) checkString(state, item.prompt, `${item?.id || '<unknown>'}.prompt`);
    if (item?.turns !== undefined) {
      check(state, Array.isArray(item.turns) && item.turns.length > 0, `${item?.id || '<unknown>'}.turns must be a non-empty array`);
      if (Array.isArray(item.turns)) for (const [index, turn] of item.turns.entries()) {
        const label = `${item?.id || '<unknown>'}.turns[${index}]`;
        check(state, ['user', 'assistant'].includes(turn?.role), `${label}.role must be user or assistant`);
        checkString(state, turn?.content, `${label}.content`);
        if (turn?.expected !== undefined) {
          check(state, Array.isArray(turn.expected) && turn.expected.every(value => typeof value === 'string' && value.trim()),
            `${label}.expected must be a string array`);
        }
      }
    }
    check(state, (typeof item?.prompt === 'string' && Boolean(item.prompt.trim()))
      || (Array.isArray(item?.turns) && item.turns.some(turn => turn?.role === 'user' && typeof turn.content === 'string' && turn.content.trim())),
    `${item?.id || '<unknown>'} must have a reviewer prompt`);
  }
  for (const item of negative) {
    checkString(state, item?.fixture, `${item?.id || '<unknown>'}.fixture`);
    checkString(state, item?.prompt, `${item?.id || '<unknown>'}.prompt`);
    checkString(state, item?.expectedResponse, `${item?.id || '<unknown>'}.expectedResponse`);
    checkString(state, item?.whyOutOfScope, `${item?.id || '<unknown>'}.whyOutOfScope`);
    check(state, Array.isArray(item?.forbidden) && item.forbidden.length > 0
      && item.forbidden.every(value => typeof value === 'string' && value.trim()),
    `${item?.id || '<unknown>'}.forbidden must be a non-empty string array`);
  }
  const environment = fixtures.reviewEnvironment;
  check(state, isObject(environment), 'reviewEnvironment must be an object');
  for (const key of ['account', 'fixtures', 'submissionPolicy', 'identifierPolicy']) {
    checkString(state, environment?.[key], `reviewEnvironment.${key}`);
  }
  const authentication = environment?.authentication;
  check(state, isObject(authentication), 'reviewEnvironment.authentication must be an object');
  check(state, authentication?.mode === 'direct_email_password', 'reviewEnvironment.authentication.mode must be direct_email_password');
  for (const key of ['additionalSetupRequired', 'thirdPartyIdentityProviderRequired']) {
    check(state, authentication?.[key] === false, `reviewEnvironment.authentication.${key} must be false`);
  }
  for (const key of ['surface', 'credentialSource', 'requiredEvidence']) {
    checkString(state, authentication?.[key], `reviewEnvironment.authentication.${key}`);
  }
  check(state, isObject(environment?.reviewerProtocol), 'reviewEnvironment.reviewerProtocol must be an object');
  for (const key of ['startingState', 'authenticationProof', 'discoveryProbeProof', 'safetyBoundary']) {
    checkString(state, environment?.reviewerProtocol?.[key], `reviewEnvironment.reviewerProtocol.${key}`);
  }
  const serialized = JSON.stringify(fixtures);
  check(state, !/\b(?:Kevin|Astuhuaman)\b/i.test(serialized), 'submission fixtures must not contain a real reviewer identity');
  check(state, !/(?:password|secret)\s*[:=]\s*["'][^"']{8,}["']/i.test(serialized), 'submission fixtures must not contain credential values');
}

async function runStatic() {
  const state = { errors: [], warnings: [] };
  let manifest;
  let metadata;
  let fixtures;
  try {
    manifest = readJson(MANIFEST_PATH);
    metadata = readJson(METADATA_PATH);
    fixtures = readJson(TESTS_PATH);
  } catch (error) {
    addError(state, `could not read plugin metadata: ${error.message}`);
    return state;
  }
  validateManifest(state, manifest, metadata);
  validateMetadata(state, metadata);
  validateMcpConfig(state, metadata);
  await validateSkills(state);
  await validateAssetsAndTree(state, manifest);
  validateSubmissionTests(state, fixtures);
  return state;
}

function parseHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (typeof value !== 'string' || !/^https:\/\/[^/\\\s?#]/i.test(value) || parsed.protocol !== 'https:') throw new Error(`${label} must use an absolute HTTPS URL`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain URL credentials`);
  return parsed;
}

function protectedMetadataChallenge(headers) {
  const challenge = String(headers['www-authenticate'] || '');
  if (!/^Bearer\s/i.test(challenge)) throw new Error('401 must advertise a Bearer challenge');
  const match = challenge.match(/(?:^|[\s,])resource_metadata\s*=\s*(?:"([^"\r\n]+)"|([^,\s]+))/i);
  if (!match) throw new Error('401 must advertise resource_metadata in WWW-Authenticate');
  const value = match[1] || match[2];
  parseHttpsUrl(value, 'resource_metadata');
  return value;
}

function wellKnownAuthorizationServerUrl(issuer) {
  const parsed = parseHttpsUrl(issuer, 'authorization server');
  if (parsed.search || parsed.hash || /[?#]/.test(issuer)) {
    throw new Error('authorization server issuer must not contain query or fragment components');
  }
  const issuerPath = parsed.pathname.replace(/\/$/, '');
  return `${parsed.origin}/.well-known/oauth-authorization-server${issuerPath}`;
}

function sameOrParentOrigin(candidate, child) {
  const candidateUrl = parseHttpsUrl(candidate, 'challenge base URL');
  const childUrl = parseHttpsUrl(child, 'MCP URL');
  const candidateHost = candidateUrl.hostname.toLowerCase();
  const childHost = childUrl.hostname.toLowerCase();
  return candidateUrl.port === childUrl.port
    && (candidateHost === childHost
      || (candidateHost === 'usetrackly.app' && childHost.endsWith('.usetrackly.app')));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = parseHttpsUrl(url, 'request URL');
    } catch (error) {
      reject(error);
      return;
    }
    let deadline;
    const finish = (error, result) => {
      clearTimeout(deadline);
      if (error) reject(error); else resolve(result);
    };
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout ?? 30000,
    }, (res) => {
      const chunks = [];
      let bodyBytes = 0;
      const maxBodyBytes = options.maxBodyBytes || 2 * 1024 * 1024;
      res.setEncoding('utf8');
      res.on('error', (error) => finish(error));
      res.on('aborted', () => finish(new Error('response aborted')));
      res.on('data', (chunk) => {
        bodyBytes += Buffer.byteLength(chunk, 'utf8');
        if (bodyBytes > maxBodyBytes) {
          res.destroy(new Error(`response exceeded ${maxBodyBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(null, {
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: chunks.join(''),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', (error) => finish(error));
    deadline = setTimeout(() => req.destroy(new Error('request timed out')), options.timeout ?? 30000);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function checkPublicPage(state, url, label) {
  try {
    let currentUrl = url;
    let response;
    for (let redirects = 0; ; redirects += 1) {
      response = await request(currentUrl, { headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' } });
      if (![301, 302, 303, 307, 308].includes(response.statusCode)) break;
      if (redirects >= 5) throw new Error('too many public-page redirects');
      if (typeof response.headers.location !== 'string' || !response.headers.location.trim()) throw new Error('redirect must include Location');
      currentUrl = parseHttpsUrl(new URL(response.headers.location, currentUrl).href, 'redirect URL').href;
    }
    check(state, response.statusCode === 200, `${label} must be publicly reachable with HTTP 200 (got ${response.statusCode})`);
  } catch (error) {
    addError(state, `${label} probe failed: ${error.message}`);
  }
}

async function runLive(state, {
  strictOrigins = false,
  requireChallenge = false,
  expectedChallenge = process.env.OPENAI_CHALLENGE_TOKEN,
  challengeBaseUrl = process.env.OPENAI_CHALLENGE_BASE_URL,
  checkPublicPages = true,
} = {}) {
  if (requireChallenge && (typeof expectedChallenge !== 'string' || !expectedChallenge || expectedChallenge.length > 4096 || /[\s{}<>]/.test(expectedChallenge))) {
    addError(state, '--require-challenge requires a valid OPENAI_CHALLENGE_TOKEN from the portal');
    return state;
  }
  const metadata = readJson(METADATA_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const mcpUrl = metadata?.productionMcpURL;
  let mcpParsed;
  try {
    mcpParsed = parseHttpsUrl(mcpUrl, 'production MCP URL');
  } catch (error) {
    addError(state, error.message);
    return state;
  }

  let challengeOrigin = mcpParsed.origin;
  if (challengeBaseUrl) {
    try {
      if (!sameOrParentOrigin(challengeBaseUrl, mcpUrl)) {
        addError(state, 'challenge base URL must be the MCP origin or a parent-domain origin');
        return state;
      }
      challengeOrigin = parseHttpsUrl(challengeBaseUrl, 'challenge base URL').origin;
    } catch (error) {
      addError(state, error.message);
    }
  }

  if (checkPublicPages) {
    await checkPublicPage(state, manifest.interface.websiteURL, 'public website');
    await checkPublicPage(state, metadata.supportURL, 'support page');
    await checkPublicPage(state, metadata.privacyPolicyURL, 'privacy policy');
    await checkPublicPage(state, metadata.termsOfServiceURL, 'terms of service');
  }

  let unauth;
  try {
    unauth = await request(mcpUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
  } catch (error) {
    addError(state, `live MCP unauthenticated probe failed: ${error.message}`);
    return state;
  }
  check(state, unauth.statusCode === 401, `live unauthenticated MCP POST must return 401 (got ${unauth.statusCode})`);
  let protectedUrl;
  try { protectedUrl = protectedMetadataChallenge(unauth.headers); }
  catch (error) { addError(state, error.message); return state; }
  let protectedResponse;
  try {
    protectedResponse = await request(protectedUrl);
  } catch (error) {
    addError(state, `live protected-resource metadata probe failed: ${error.message}`);
    return state;
  }
  check(state, protectedResponse.statusCode === 200, `protected-resource metadata must return 200 (got ${protectedResponse.statusCode})`);
  let protectedMetadata;
  try {
    protectedMetadata = JSON.parse(protectedResponse.body);
  } catch {
    addError(state, 'protected-resource metadata must be valid JSON');
  }
  check(state, isObject(protectedMetadata), 'protected-resource metadata must be a JSON object');
  if (isObject(protectedMetadata)) {
    const schemaResult = OAuthProtectedResourceMetadataSchema.safeParse(protectedMetadata);
    if (!schemaResult.success) {
      for (const issue of schemaResult.error.issues) {
        addError(state, `protected-resource metadata has invalid ${issue.path.join('.') || 'shape'} (MCP SDK OAuthProtectedResourceMetadataSchema)`);
      }
    }
    check(state, protectedMetadata.resource === mcpUrl, 'protected-resource metadata resource must exactly match the plugin MCP URL');
    const servers = protectedMetadata.authorization_servers;
    let serversValid = Array.isArray(servers) && servers.length > 0;
    if (Array.isArray(servers)) {
      for (const server of servers) {
        try { wellKnownAuthorizationServerUrl(server); }
        catch { serversValid = false; addError(state, 'every authorization_servers entry must be a valid HTTPS issuer without query or fragment'); }
      }
    }
    if (serversValid && servers.length > 1) addWarning(state, 'multiple authorization servers advertised; URL syntax is checked for all, but live discovery probes only the first');
    const authorizationServer = serversValid ? servers[0] : undefined;
    check(state, typeof authorizationServer === 'string', 'protected-resource metadata must advertise an authorization server');
    if (typeof authorizationServer === 'string') {
      try {
        const asMetadataUrl = wellKnownAuthorizationServerUrl(authorizationServer);
        const asResponse = await request(asMetadataUrl);
        check(state, asResponse.statusCode === 200, `authorization-server metadata must return 200 (got ${asResponse.statusCode})`);
        let asMetadata;
        try {
          asMetadata = JSON.parse(asResponse.body);
        } catch {
          addError(state, 'authorization-server metadata must be valid JSON');
        }
        check(state, isObject(asMetadata), 'authorization-server metadata must be a JSON object');
        if (isObject(asMetadata)) {
          const schemaResult = OAuthMetadataSchema.safeParse(asMetadata);
          if (!schemaResult.success) {
            // Report field paths only; remote metadata values may contain sensitive data.
            for (const issue of schemaResult.error.issues) {
              addError(state, `authorization-server metadata has invalid ${issue.path.join('.') || 'shape'} (MCP SDK OAuthMetadataSchema)`);
            }
          }
          check(state, typeof asMetadata.issuer === 'string', 'authorization-server metadata must include issuer');
          check(state, asMetadata.issuer === authorizationServer, `issuer must exactly equal protected authorization_servers entry (issuer=${asMetadata.issuer}, advertised=${authorizationServer})`);
          check(state, Array.isArray(asMetadata.response_types_supported) && asMetadata.response_types_supported.includes('code'), 'authorization-server metadata must advertise authorization-code response type code');
          if (asMetadata.grant_types_supported !== undefined) {
            check(state, Array.isArray(asMetadata.grant_types_supported) && asMetadata.grant_types_supported.includes('authorization_code'),
              'authorization-server grant_types_supported must include authorization_code when present');
          }
          check(state, Array.isArray(asMetadata.code_challenge_methods_supported) && asMetadata.code_challenge_methods_supported.includes('S256'), 'authorization-server metadata must advertise PKCE S256');
          check(state, asMetadata.client_id_metadata_document_supported === true || typeof asMetadata.registration_endpoint === 'string',
            'authorization-server metadata must support URL-based client IDs or dynamic client registration');
          if (asMetadata.registration_endpoint !== undefined) {
            try {
              const registrationUrl = parseHttpsUrl(asMetadata.registration_endpoint, 'authorization-server registration_endpoint');
              check(state, !registrationUrl.hash && !asMetadata.registration_endpoint.includes('#'), 'authorization-server registration_endpoint must not contain a fragment');
            } catch (error) { addError(state, error.message); }
          }
          for (const endpoint of ['authorization_endpoint', 'token_endpoint']) {
            try {
              const endpointUrl = parseHttpsUrl(asMetadata[endpoint], `authorization-server ${endpoint}`);
              check(state, !endpointUrl.hash && !asMetadata[endpoint].includes('#'), `authorization-server ${endpoint} must not contain a fragment`);
            } catch (error) {
              addError(state, error.message);
            }
          }
          if (asMetadata.authorization_response_iss_parameter_supported === true) {
            addWarning(state, 'authorization server advertises stable callback mode; prove an iss parameter on every success and error callback in the credentialed portal run');
          } else {
            addWarning(state, 'authorization server uses callback-specific mode; prove the exact redirect URI in the credentialed portal run');
          }
        }
      } catch (error) {
        addError(state, `live authorization-server metadata probe failed: ${error.message}`);
      }
    }
  }

  for (const origin of OFFICIAL_CLIENT_ORIGINS) {
    try {
      const response = await request(mcpUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          origin,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }),
      });
      if (response.statusCode === 403) {
        const message = `live MCP rejects Origin ${origin} with 403 before authentication`;
        if (strictOrigins) addError(state, message); else addWarning(state, message);
      } else if (response.statusCode !== 401) {
        (strictOrigins ? addError : addWarning)(state, `origin probe ${origin} returned unexpected HTTP ${response.statusCode}`);
      } else {
        try {
          if (protectedMetadataChallenge(response.headers) !== protectedUrl) throw new Error('resource_metadata must match the originless challenge');
        } catch (error) { (strictOrigins ? addError : addWarning)(state, `origin probe ${origin}: ${error.message}`); }
      }
    } catch (error) {
      (strictOrigins ? addError : addWarning)(state, `origin probe ${origin} failed: ${error.message}`);
    }
  }

  const challengeUrl = `${challengeOrigin}/.well-known/openai-apps-challenge`;
  try {
    const challengeResponse = await request(challengeUrl);
    if (requireChallenge) {
      check(state, challengeResponse.statusCode === 200, `domain challenge must return 200 when required (got ${challengeResponse.statusCode})`);
      check(state, challengeResponse.body === expectedChallenge, 'domain challenge body must exactly match the portal-issued token');
    } else if (challengeResponse.statusCode !== 200) {
      addWarning(state, `domain challenge is ${challengeResponse.statusCode}; this is expected until the portal provisions a token`);
    }
  } catch (error) {
    if (requireChallenge) addError(state, `domain challenge probe failed: ${error.message}`);
    else addWarning(state, `domain challenge probe failed: ${error.message}`);
  }
  return state;
}

function printResult(state, jsonOutput = false) {
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: state.errors.length === 0, errors: state.errors, warnings: state.warnings }, null, 2));
    return;
  }
  for (const warning of state.warnings) console.warn(`WARN: ${warning}`);
  if (state.errors.length > 0) {
    for (const error of state.errors) console.error(`ERROR: ${error}`);
    console.error(`Plugin submission preflight failed with ${state.errors.length} error(s).`);
    return;
  }
  console.log(`Plugin submission preflight passed${state.warnings.length ? ` with ${state.warnings.length} warning(s)` : ''}.`);
}

async function main(argv = process.argv.slice(2)) {
  const live = argv.includes('--live');
  const strictOrigins = argv.includes('--strict-origins');
  const requireChallenge = argv.includes('--require-challenge');
  const jsonOutput = argv.includes('--json');
  const challengeFlag = argv.find((value) => value.startsWith('--challenge-base-url='));
  const challengeIndex = argv.indexOf('--challenge-base-url');
  const challengeBaseUrl = challengeFlag
    ? challengeFlag.slice('--challenge-base-url='.length)
    : (challengeIndex >= 0 ? argv[challengeIndex + 1] : process.env.OPENAI_CHALLENGE_BASE_URL);
  const state = await runStatic();
  const booleanFlags = new Set(['--live', '--strict-origins', '--require-challenge', '--json']);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (booleanFlags.has(value) || value.startsWith('--challenge-base-url=')) continue;
    if (value === '--challenge-base-url') {
      if (argv[index + 1] && !argv[index + 1].startsWith('--')) index += 1;
      continue;
    }
    addError(state, `unknown argument: ${value}`);
  }
  if ((challengeFlag !== undefined || challengeIndex >= 0) && (!challengeBaseUrl || challengeBaseUrl.startsWith('--'))) {
    addError(state, '--challenge-base-url requires an HTTPS origin value');
  }
  if (!live && (strictOrigins || requireChallenge || challengeFlag !== undefined || challengeIndex >= 0)) {
    addError(state, '--strict-origins, --require-challenge, and --challenge-base-url require --live');
  }
  if (challengeBaseUrl) {
    try {
      const parsed = parseHttpsUrl(challengeBaseUrl, '--challenge-base-url');
      check(state, parsed.pathname === '/' && !parsed.search && !parsed.hash, '--challenge-base-url must be an HTTPS origin');
    } catch (error) { addError(state, error.message); }
  }
  if (state.errors.length === 0 && live) {
    await runLive(state, { strictOrigins, requireChallenge, challengeBaseUrl });
  }
  printResult(state, jsonOutput);
  return state.errors.length === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_PORTAL_POSITIVE_IDS,
  normalizePrompt,
  checkSupportedText,
  checkPublicPage,
  runLive,
  runStatic,
  validateManifest,
  validateMetadata,
  validateMcpConfig,
  validateSkills,
  validateSubmissionTests,
};
