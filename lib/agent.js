'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { apiRequest, downloadFile, getConfigPaths, hasAuth, maintenanceOutput } = require('./client');
const { version: PACKAGE_VERSION } = require('../package.json');
const SKILL_VERSION = '1.1.0';
const CLI_USER_AGENT = `trackly-cli/${PACKAGE_VERSION}`;
const MCP_USER_AGENT = `trackly-mcp/${PACKAGE_VERSION}`;

const SKILL_NAME = 'trackly-apply';
const SKILL_MAJOR = Number(SKILL_VERSION.split('.')[0]);
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MANAGED_FILE = '.trackly-managed.json';

function bundledSkillDir() {
  return path.join(__dirname, '..', 'skills', SKILL_NAME);
}

function canonicalSkillDir() {
  return path.resolve(getConfigPaths().dir, 'skills', SKILL_NAME);
}

function clientSkillDir(client) {
  if (client === 'codex') {
    return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', SKILL_NAME);
  }
  if (client === 'claude') {
    return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', SKILL_NAME);
  }
  throw new Error(`Unsupported agent client: ${client}`);
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try { fs.chmodSync(dir, mode); } catch (_) {}
}

function copyDirectory(source, destination) {
  ensureDir(destination, 0o700);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function managedMetadata(extra = {}) {
  return JSON.stringify({ managedBy: 'trackly-cli', skill: SKILL_NAME, skillVersion: SKILL_VERSION, ...extra }, null, 2);
}

function isManagedDirectory(target) {
  return managedSkillMetadata(target) !== null;
}

function managedSkillMetadata(target) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(target, MANAGED_FILE), 'utf8'));
    return metadata.managedBy === 'trackly-cli' && metadata.skill === SKILL_NAME ? metadata : null;
  } catch (_) {
    return null;
  }
}

function installCanonicalSkill() {
  const source = bundledSkillDir();
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error('The npm package does not contain the Trackly Apply skill. Reinstall trackly-cli.');
  }
  const destination = canonicalSkillDir();
  const parent = path.dirname(destination);
  ensureDir(parent, 0o700);
  const staging = `${destination}.staging.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    copyDirectory(source, staging);
    fs.writeFileSync(path.join(staging, MANAGED_FILE), managedMetadata(), { mode: 0o600 });
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  if (fs.existsSync(destination)) {
    try {
      const stat = fs.lstatSync(destination);
      if (!stat.isDirectory() || !isManagedDirectory(destination)) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw new Error(`Refusing to overwrite unmanaged skill at ${destination}`);
      }
      const previous = `${destination}.previous.${process.pid}`;
      fs.renameSync(destination, previous);
      try {
        fs.renameSync(staging, destination);
        fs.rmSync(previous, { recursive: true, force: true });
      } catch (error) {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
        if (!fs.existsSync(destination)) fs.renameSync(previous, destination);
        throw error;
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        try {
          fs.renameSync(staging, destination);
        } catch (renameError) {
          if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
          throw renameError;
        }
      } else {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
        throw error;
      }
    }
  } else {
    try {
      fs.renameSync(staging, destination);
    } catch (error) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }
  return destination;
}

function linkClientSkill(client, canonical) {
  const target = clientSkillDir(client);
  ensureDir(path.dirname(target), 0o700);
  let backup = null;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() && path.resolve(path.dirname(target), fs.readlinkSync(target)) === canonical) {
      return { client, target, method: 'symlink', status: 'current' };
    }
    if (!isManagedDirectory(target)) {
      throw new Error(`Refusing to overwrite unmanaged skill at ${target}`);
    }
    backup = `${target}.previous.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.renameSync(target, backup);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }

  try {
    fs.symlinkSync(canonical, target, 'dir');
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
    return { client, target, method: 'symlink', status: 'installed' };
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)) {
      if (backup && !fs.existsSync(target)) fs.renameSync(backup, target);
      throw error;
    }
    const staging = `${target}.staging.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
      copyDirectory(canonical, staging);
      fs.writeFileSync(path.join(staging, MANAGED_FILE), managedMetadata({ copiedFrom: canonical }), { mode: 0o600 });
      fs.renameSync(staging, target);
      if (backup) fs.rmSync(backup, { recursive: true, force: true });
      return { client, target, method: 'copy', status: 'installed' };
    } catch (copyError) {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (backup) fs.renameSync(backup, target);
      throw copyError;
    }
  }
}

function normalizeClients(client) {
  if (client === 'both') return ['codex', 'claude'];
  if (client === 'codex' || client === 'claude') return [client];
  throw new Error('Use --client codex, claude, or both.');
}

function codexMcpRegistration(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return 'missing'; }
  const header = /^\s*\[mcp_servers\.trackly\]\s*(?:#.*)?$/m;
  const match = header.exec(text);
  if (!match) return 'missing';
  const bodyStart = match.index + match[0].length;
  const remainder = text.slice(bodyStart);
  const nextTable = remainder.search(/^\s*\[/m);
  const body = nextTable === -1 ? remainder : remainder.slice(0, nextTable);
  const commandMatches = /^\s*command\s*=\s*["']trackly["']\s*(?:#.*)?$/m.test(body);
  const argsMatches = /^\s*args\s*=\s*\[\s*["']mcp["']\s*\]\s*(?:#.*)?$/m.test(body);
  return commandMatches && argsMatches ? 'current' : 'stale';
}

function claudeMcpRegistration(files) {
  let found = false;
  for (const file of files) {
    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entry = config?.mcpServers?.trackly;
      if (!entry) continue;
      found = true;
      if (entry.command === 'trackly' && Array.isArray(entry.args)
          && entry.args.length === 1 && entry.args[0] === 'mcp') {
        return 'current';
      }
    } catch (_) {}
  }
  return found ? 'stale' : 'missing';
}

function mcpRegistrationState(client) {
  const claudeConfigFiles = process.env.CLAUDE_CONFIG_DIR
    ? [path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')]
    : [path.join(os.homedir(), '.claude.json'), path.join(os.homedir(), '.claude', 'settings.json')];
  return client === 'codex'
    ? codexMcpRegistration(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'))
    : claudeMcpRegistration(claudeConfigFiles);
}

function isMissingMcpRegistrationError(result) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length === 1
    && /^no mcp server named ["']?trackly["']? in user scope\.?$/i.test(lines[0]);
}

function registerMcp(client) {
  const executable = client === 'codex' ? 'codex' : 'claude';
  if (!commandExists(executable)) return { status: 'missing_client', error: `${executable} is not installed` };
  const registration = mcpRegistrationState(client);
  if (registration === 'current') return { status: 'current' };
  if (registration === 'stale') {
    const removeArgs = client === 'codex'
      ? ['mcp', 'remove', 'trackly']
      : ['mcp', 'remove', '--scope', 'user', 'trackly'];
    const removed = spawnSync(executable, removeArgs, { encoding: 'utf8' });
    const alreadyMissing = client === 'claude' && isMissingMcpRegistrationError(removed);
    if (removed.status !== 0 && !alreadyMissing) {
      return { status: 'failed', error: (removed.stderr || removed.stdout || 'Unable to replace stale MCP registration').trim() };
    }
  }
  const args = client === 'codex'
    ? ['mcp', 'add', 'trackly', '--', 'trackly', 'mcp']
    : ['mcp', 'add', '--scope', 'user', 'trackly', '--', 'trackly', 'mcp'];
  const result = spawnSync(executable, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    return { status: 'failed', error: (result.stderr || result.stdout || 'MCP registration failed').trim() };
  }
  return { status: 'installed' };
}

function setupAgent(client) {
  const canonical = installCanonicalSkill();
  const clients = normalizeClients(client).map((name) => ({
    ...linkClientSkill(name, canonical),
    mcp: registerMcp(name),
  }));
  return {
    skillVersion: SKILL_VERSION,
    canonical,
    clients,
  };
}

function commandExists(command) {
  if (command !== 'codex' && command !== 'claude') return false;
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => {
      try {
        fs.accessSync(path.join(directory, command), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function inspectClient(client) {
  const target = clientSkillDir(client);
  const executable = commandExists(client === 'codex' ? 'codex' : 'claude');
  const metadata = managedSkillMetadata(target);
  const installed = fs.existsSync(path.join(target, 'SKILL.md')) && metadata?.skillVersion === SKILL_VERSION;
  const mcpRegistration = mcpRegistrationState(client);
  const mcpRegistered = mcpRegistration === 'current';
  return { client, executable, installed, installedSkillVersion: metadata?.skillVersion || null, mcpRegistered, mcpRegistration, target };
}

function cacheDir() {
  return path.resolve(getConfigPaths().dir, 'cache', 'resumes');
}

function cleanResumeCache(now = Date.now()) {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return { removed: 0, directory: dir };
  let removed = 0;

  function cleanDirectory(current, removeWhenExpired = false) {
    const directoryExpired = removeWhenExpired && now - fs.statSync(current).mtimeMs > CACHE_TTL_MS;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) {
        cleanDirectory(item, true);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(item);
      if (now - stat.mtimeMs > CACHE_TTL_MS) {
        fs.rmSync(item, { force: true });
        removed++;
      }
    }
    if (directoryExpired && fs.readdirSync(current).length === 0) fs.rmdirSync(current);
  }

  cleanDirectory(dir);
  return { removed, directory: dir };
}

function safeResumeName(fileName, contentType) {
  const extension = contentType === 'application/pdf' ? '.pdf' : '.docx';
  const value = fileName == null || fileName === '' ? `resume${extension}` : String(fileName);
  const invalid = value === '.'
    || value === '..'
    || value !== value.trim()
    || /[\\/\0-\x1f\x7f]/.test(value)
    || Buffer.byteLength(value, 'utf8') > 240
    || !value.toLowerCase().endsWith(extension);
  if (invalid) throw new Error('Trackly returned an unsafe or incompatible resume filename. Update the default resume and try again.');
  return value;
}

function resumeCacheName(fileName, contentType, now = Date.now(), nonce = crypto.randomBytes(4).toString('hex')) {
  return path.join(`${now}-${nonce}`, safeResumeName(fileName, contentType));
}

function resumeConfirmation(fileName, sha256, sizeBytes, exactLocalPath, runId, expiresAt, confirmationId) {
  return {
    required: true,
    source: 'trackly_default_resume',
    runId,
    confirmationId,
    fileName,
    sha256,
    sizeBytes,
    expiresAt,
    verification: {
      preferred: 'local_preview',
      exactLocalPath,
      revealPathOnRequest: true,
    },
  };
}

function materializeResume(download, options = {}) {
  const runId = Number(options.runId);
  if (!Number.isInteger(runId) || runId < 1) throw new Error('A valid Trackly Apply run ID is required before preparing a resume.');
  const now = options.now ?? Date.now();
  const nonce = options.nonce ?? crypto.randomBytes(4).toString('hex');
  const confirmationId = options.confirmationId ?? crypto.randomUUID();
  const validated = validateResumeFile(download);
  const dir = cacheDir();
  ensureDir(dir, 0o700);
  const name = resumeCacheName(download.fileName, validated.contentType, now, nonce);
  const destination = path.join(dir, name);
  ensureDir(path.dirname(destination), 0o700);
  fs.writeFileSync(destination, download.buffer, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(destination, 0o600); } catch (_) {}
  const fileName = path.basename(destination);
  const expiresAt = new Date(now + CACHE_TTL_MS).toISOString();
  return {
    path: destination,
    fileName,
    contentType: validated.contentType,
    sha256: validated.digest,
    sizeBytes: download.buffer.length,
    expiresAt,
    confirmation: resumeConfirmation(
      fileName,
      validated.digest,
      download.buffer.length,
      destination,
      runId,
      expiresAt,
      confirmationId,
    ),
  };
}

function validateResumeFile(download) {
  const digest = crypto.createHash('sha256').update(download.buffer).digest('hex');
  if (download.sha256 && String(download.sha256).toLowerCase() !== digest) {
    throw new Error('Downloaded resume failed its SHA-256 integrity check.');
  }
  const isPdf = download.buffer.subarray(0, 5).toString() === '%PDF-';
  const isZip = download.buffer[0] === 0x50 && download.buffer[1] === 0x4b;
  const hasContentTypes = download.buffer.includes(Buffer.from('[Content_Types].xml'));
  const hasWordDocument = download.buffer.includes(Buffer.from('word/document.xml'));
  const isDocx = isZip && hasContentTypes && hasWordDocument;
  if (!isPdf && !isDocx) throw new Error(`Unsupported or invalid resume type: ${download.contentType}`);
  return {
    digest,
    contentType: isPdf
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

async function prepareResume(runId, userAgent = MCP_USER_AGENT) {
  if (!hasAuth()) throw new Error('Authenticate first with `trackly login` or `trackly config --api-key ...`.');
  cleanResumeCache();
  const download = await downloadFile('/api/jobscout/application-profile/default-resume', userAgent);
  try {
    return materializeResume(download, { runId });
  } finally {
    download.buffer.fill(0);
  }
}

async function doctorAgent() {
  const cache = cleanResumeCache();
  const report = {
    skillVersion: SKILL_VERSION,
    authenticated: hasAuth(),
    clients: ['codex', 'claude'].map(inspectClient),
    browserControl: {
      codex: fs.existsSync(path.join(os.homedir(), '.codex', 'plugins', 'cache', 'openai-bundled', 'chrome')),
      codexComputerUse: fs.existsSync(path.join(os.homedir(), '.codex', 'plugins', 'cache', 'openai-bundled', 'computer-use')),
      claude: null,
      note: 'Capability is client-managed; verify Chrome/browser and computer-use tools are enabled before a live run.',
    },
    cache,
    protocol: null,
    profile: null,
    resume: { verified: false },
    compatible: false,
    ok: false,
  };
  if (!report.authenticated) return report;
  try {
    const [protocol, profile] = await Promise.all([
      apiRequest('GET', '/api/jobscout/apply/protocol'),
      apiRequest('GET', '/api/jobscout/application-profile'),
    ]);
    report.protocol = protocol.protocol || protocol;
    report.profile = {
      revision: profile.profile?.revision,
      completeness: profile.profile?.completeness,
      hasDefaultResume: Boolean(profile.profile?.defaultResume),
    };
    report.compatible = Number(report.protocol.compatibleSkillMajor) === SKILL_MAJOR;
    if (report.profile.hasDefaultResume) {
      try {
        const prepared = await prepareResume(1, CLI_USER_AGENT);
        const mode = fs.statSync(prepared.path).mode & 0o777;
        report.resume = {
          verified: mode === 0o600,
          contentType: prepared.contentType,
          permissions: mode.toString(8).padStart(3, '0'),
          expiresAt: prepared.expiresAt,
        };
        if (!report.resume.verified) report.resume.error = 'Prepared resume cache file is not mode 0600.';
      } catch (error) {
        const maintenance = maintenanceOutput(error);
        report.resume = {
          verified: false,
          error: error.error || error.message || String(error),
          ...(maintenance ? { maintenance } : {}),
        };
      }
    }
  } catch (error) {
    report.apiError = maintenanceOutput(error) || error.error || error.message || String(error);
  }
  report.ok = report.authenticated
    && report.compatible
    && report.clients.some((client) => client.executable && client.installed && client.mcpRegistered)
    && Boolean(report.profile?.hasDefaultResume)
    && report.resume.verified
    && report.profile?.completeness?.missingKeys?.length === 0;
  return report;
}

function resumeValidationStatus(report) {
  if (!report?.profile?.hasDefaultResume) return 'not applicable (no default resume set)';
  return report.resume?.verified ? 'passed' : 'failed';
}

module.exports = {
  CACHE_TTL_MS,
  CLI_USER_AGENT,
  MCP_USER_AGENT,
  SKILL_MAJOR,
  SKILL_NAME,
  bundledSkillDir,
  cacheDir,
  canonicalSkillDir,
  cleanResumeCache,
  clientSkillDir,
  doctorAgent,
  inspectClient,
  materializeResume,
  prepareResume,
  resumeConfirmation,
  resumeCacheName,
  resumeValidationStatus,
  setupAgent,
  validateResumeFile,
};
