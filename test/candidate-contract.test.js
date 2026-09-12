'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyCandidateContract, assertSurfaceEnumBindings, assertCandidateCheckpointActionSchema } = require('../scripts/verify-candidate-contract');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trackly-candidate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backendDir = path.join(root, 'backend');
  const cliRoot = path.join(root, 'cli');
  const write = (dir, file, value) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.endsWith('.js') || file.endsWith('.ts')
      ? 'const SAFE_OBSERVATION_CODE = /^[a-z0-9][a-z0-9_:-]{0,99}$/;\n' + value : value);
  };
  const contract = { contractVersion: '3.9.2', tools: { trackly_example: '{value:z.string()}' } };
  write(backendDir, 'contracts/trackly-apply-tools.json', JSON.stringify(contract));
  write(cliRoot, 'contracts/trackly-apply-tools.json', JSON.stringify({ ...contract, schemaDigests: {} }));
  write(cliRoot, 'mcp/apply-tools.js', "function registerApplyTools(server) { server.tool('trackly_example', 'example', {value:z.string()}, handler); }");
  write(backendDir, 'src/mcp/server.ts', "registerHostedMcpTool(server, 'trackly_example', 'example', {value:z.string()}, handler);");
  const git = args => execFileSync('git', ['-C', backendDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  const commit = () => { git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'synthetic candidate']); return git(['rev-parse', 'HEAD']); };
  return { backendDir, cliRoot, write, commit, expectedBackendSha: commit() };
}

test('candidate verification requires an explicit full SHA and exact clean backend', t => {
  const f = fixture(t);
  assert.throws(() => verifyCandidateContract({ ...f, expectedBackendSha: 'abc' }), /full 40-character/);
  assert.throws(() => verifyCandidateContract({ ...f, expectedBackendSha: 'a'.repeat(40) }), /HEAD must match/);
  f.write(f.backendDir, 'untracked.txt', 'untracked');
  assert.throws(() => verifyCandidateContract(f), /completely clean/);
});

test('candidate verification rejects missing shared tools', t => {
  const f = fixture(t);
  f.write(f.backendDir, 'contracts/trackly-apply-tools.json', JSON.stringify({ contractVersion: '3.9.2', tools: {} }));
  f.expectedBackendSha = f.commit();
  assert.throws(() => verifyCandidateContract(f), /shared contract drifted/);
});

for (const lane of ['local', 'hosted']) {
  test(`candidate verification rejects ${lane} executable schema drift`, t => {
    const f = fixture(t);
    if (lane === 'local') {
      f.write(f.cliRoot, 'mcp/apply-tools.js', "server.tool('trackly_example', 'example', {value:z.number()}, handler);");
    } else {
      f.write(f.backendDir, 'src/mcp/server.ts', "registerHostedMcpTool(server, 'trackly_example', 'example', {value:z.number()}, handler);");
      f.expectedBackendSha = f.commit();
    }
    assert.throws(() => verifyCandidateContract(f), new RegExp(`${lane} trackly_example executable schema drifted`));
  });
}

for (const mutation of ['unbounded', 'missing', 'dead']) {
  test(`candidate verification rejects ${mutation} local adapter transport`, t => {
    const f = fixture(t);
    const target = path.join(f.cliRoot, 'mcp/apply-tools.js');
    let source = fs.readFileSync(target, 'utf8');
    if (mutation === 'unbounded') source = source.replace('/^[a-z0-9][a-z0-9_:-]{0,99}$/', '/.*/');
    if (mutation === 'missing') source = source.replace("server.tool('trackly_example', 'example', {value:z.string()}, handler);", '');
    if (mutation === 'dead') source = source.replace('server.tool(', 'if (false) server.tool(');
    fs.writeFileSync(target, source);
    assert.throws(() => verifyCandidateContract(f), error => error.code === 'ERR_ASSERTION' && (mutation === 'unbounded'
      ? /bounded machine-code/ : mutation === 'missing' ? /exactly one registration/ : /registration|straight-line|direct/).test(error.message));
  });
}

for (const suffix of ['BINDING_REASONS', 'EVIDENCE_TYPES', 'OWNERSHIP_STATES']) {
  test(`candidate rejects detached surface enum ${suffix}`, () => {
    const source = fs.readFileSync(path.join(__dirname, '../mcp/apply-tools.js'), 'utf8');
    const name = `APPLY_SURFACE_${suffix}`;
    const mutated = source.replace(new RegExp(`const ${name} = [^;]+;`), `const ${name} = ['unexpected'];`);
    assert.notEqual(mutated, source);
    assert.throws(() => assertSurfaceEnumBindings(mutated, '', '', {}), /local surface enum binding drifted/);
  });
}

test('surface enum parity accepts canonical aliases and rejects changed backend values or imports', () => {
  const bindings = { BINDING_REASONS: 'applySurfaceBindingReasons', EVIDENCE_TYPES: 'applySurfaceEvidenceTypes', OWNERSHIP_STATES: 'applySurfaceOwnershipStates' };
  const constants = { ...Object.fromEntries(Object.values(bindings).map(key => [key, ['expected']])), applyBatchConflictCodes: ['state_changed', 'client_upgrade_required'] };
  const local = Object.entries(bindings).map(([suffix, key]) => `const APPLY_SURFACE_${suffix} = APPLY_CONTRACT.constants.${key};`).join('\n');
  const hosted = `import { ${Object.keys(bindings).map(s => `APPLY_BATCH_SURFACE_${s}`).join(', ')} } from '../services/application-profile/batch-service.js';\n`
    + Object.keys(bindings).map(s => `const APPLY_SURFACE_${s} = APPLY_BATCH_SURFACE_${s};`).join('\n');
  const batch = Object.keys(bindings).map(s => `export const APPLY_BATCH_SURFACE_${s} = ['expected'] as const;`).join('\n')
    + "\nexport const APPLY_BATCH_CONFLICT_CODES = ['state_changed', 'client_upgrade_required'] as const;";
  assert.doesNotThrow(() => assertSurfaceEnumBindings(local, hosted, batch, constants));
  assert.throws(() => assertSurfaceEnumBindings(local, hosted, batch.replace(", 'client_upgrade_required'", ''), constants), /backend conflict enum values drifted/);
  assert.throws(() => assertSurfaceEnumBindings(local, hosted, batch.replace("['expected']", "['unexpected']"), constants), /backend surface enum values drifted/);
  assert.throws(() => assertSurfaceEnumBindings(local, hosted.replace('batch-service.js', 'untrusted.js'), batch, constants), /import/);
});

test('candidate AST comparison rejects literal drift hidden by historical whitespace normalization', t => {
  const f = fixture(t);
  const contract = { contractVersion: '3.9.2', tools: { trackly_example: "{value:z.string().describe('ab')}" } };
  f.write(f.cliRoot, 'contracts/trackly-apply-tools.json', JSON.stringify({ ...contract, schemaDigests: {} }));
  f.write(f.backendDir, 'contracts/trackly-apply-tools.json', JSON.stringify(contract));
  f.write(f.cliRoot, 'mcp/apply-tools.js', "function registerApplyTools(server) { server.tool('trackly_example', 'example', {value:z.string().describe('a b')}, handler); }");
  f.write(f.backendDir, 'src/mcp/server.ts', "registerHostedMcpTool(server, 'trackly_example', 'example', {value:z.string().describe('ab')}, handler);");
  f.expectedBackendSha = f.commit();
  assert.throws(() => verifyCandidateContract(f), /executable schema drifted/);
});

test('candidate checkpoint pin rejects an unexpected variant and another contract generation', () => {
  const actions = require('../contracts/trackly-apply-tools.json').constants.applyCheckpointActionCodes;
  const source = `const applyCheckpointActionSchema = z.discriminatedUnion('actionCode', [${actions.map(code => `applyCheckpointActionVariant('${code}')`).join(',')}]);`;
  assert.doesNotThrow(() => assertCandidateCheckpointActionSchema(source, '3.9.2'));
  assert.throws(() => assertCandidateCheckpointActionSchema(source.replace('client/upgrade_required', 'client/unexpected'), '3.9.2'), /locked active semantic AST/);
  assert.throws(() => assertCandidateCheckpointActionSchema(source, '3.9.1'), /requires contract 3.9.2/);
});

test('candidate writer requires the exact awaited schema guard and preserves the deployed boundary', () => {
  const { assertCheckpointWriterCallChain } = require('../scripts/verify-hosted-contract');
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/candidate-checkpoint-writer.txt'), 'utf8');
  assert.doesNotThrow(() => assertCheckpointWriterCallChain(source, 'candidate fixture', 'candidate-3.9.2'));
  assert.throws(() => assertCheckpointWriterCallChain(source.replace('await upgradeClientActionTypeSchemaReady(queryable)', 'true'), 'mutated candidate', 'candidate-3.9.2'), /locked validation prefix/);
  assert.throws(() => assertCheckpointWriterCallChain(source, 'deployed fixture'), /locked validation prefix/);
});


test('candidate rejects the same whitespace-sensitive literal drift in both executable lanes', t => {
  const f = fixture(t);
  const contract = { contractVersion: '3.9.2', tools: { trackly_example: "{value:z.string().describe('ab')}" } };
  f.write(f.cliRoot, 'contracts/trackly-apply-tools.json', JSON.stringify({ ...contract, schemaDigests: {} }));
  f.write(f.backendDir, 'contracts/trackly-apply-tools.json', JSON.stringify(contract));
  f.write(f.cliRoot, 'mcp/apply-tools.js', "function registerApplyTools(server) { server.tool('trackly_example', 'example', {value:z.string().describe('a b')}, handler); }");
  f.write(f.backendDir, 'src/mcp/server.ts', "registerHostedMcpTool(server, 'trackly_example', 'example', {value:z.string().describe('a b')}, handler);");
  f.expectedBackendSha = f.commit();
  assert.throws(() => verifyCandidateContract(f), /executable schema drifted/);
});

for (const mutation of ['extra', 'moved']) {
  test(`candidate rejects ${mutation} local registration outside its declared direct catalog`, t => {
    const f = fixture(t);
    f.write(f.cliRoot, 'mcp/apply-tools.js', mutation === 'extra'
      ? "function registerApplyTools(server) { server.tool('trackly_example', 'example', {value:z.string()}, handler); server.tool('trackly_extra', 'extra', {}, handler); }"
      : "function registerApplyTools(server) { server.registerPrompt('prompt', {}, handler); } function unrelated(server) { server.tool('trackly_example', 'example', {value:z.string()}, handler); }");
    assert.throws(() => verifyCandidateContract(f), /local direct tool catalog/);
  });
}

test('candidate writer refuses an always-ready executable helper while retaining its awaited guard', () => {
  const { assertCheckpointWriterCallChain } = require('../scripts/verify-hosted-contract');
  const writer = fs.readFileSync(path.join(__dirname, 'fixtures/candidate-checkpoint-writer.txt'), 'utf8');
  const altered = writer.replace('return probeUpgradeClientActionTypeSchemaReady(queryable, 0);', 'return true;');
  assert.throws(() => assertCheckpointWriterCallChain(altered, 'always ready candidate', 'candidate-3.9.2'), /upgradeClientActionTypeSchemaReady.*locked active semantic AST/);
});


test('candidate writer also refuses an always-ready delegated database probe', () => {
  const { assertCheckpointWriterCallChain, activeNamedDefinitionAst } = require('../scripts/verify-hosted-contract');
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/candidate-checkpoint-writer.txt'), 'utf8');
  const probe = activeNamedDefinitionAst(source, 'probeUpgradeClientActionTypeSchemaReady', 'fixture');
  const changed = source.slice(0, probe.start) + 'async function probeUpgradeClientActionTypeSchemaReady(queryable, attempt) { return true; }' + source.slice(probe.end);
  assert.throws(() => assertCheckpointWriterCallChain(changed, 'always ready probe', 'candidate-3.9.2'), /probeUpgradeClientActionTypeSchemaReady.*locked active semantic AST/);
});


test('legacy 3.9.2 decoder accepts only reviewed raw schemas and preserves exact executable literals', () => {
  const { expectedContractSchemaAst } = require('../scripts/verify-candidate-contract');
  const { activeToolRegistrations, registrationInputSchemaAst, canonicalSchemaAst } = require('../scripts/verify-hosted-contract');
  const contract = require('../contracts/trackly-apply-tools.json');
  const source = fs.readFileSync(path.join(__dirname, '../mcp/apply-tools.js'), 'utf8');
  const registrations = activeToolRegistrations(source, 'server.tool', 'reviewed local');
  for (const name of ['trackly_recover_exact_apply_members', 'trackly_claim_apply_review_handoff',
    'trackly_get_apply_execution_snapshot', 'trackly_advance_apply_execution', 'trackly_record_application_outcomes']) {
    const raw = contract.tools[name];
    const actual = canonicalSchemaAst(registrationInputSchemaAst(source, registrations.find(entry => entry.name === name), 'local'));
    for (const lane of ['local', 'hosted']) assert.deepEqual(expectedContractSchemaAst(name, raw, '3.9.2', lane), actual);
    assert.throws(() => expectedContractSchemaAst(name, raw + ' ', '3.9.2', 'local'), /unknown legacy raw schema/);
    assert.throws(() => expectedContractSchemaAst(name, raw, '3.9.3', 'local'), /requires contract 3.9.2/);
    assert.throws(() => expectedContractSchemaAst(name, raw, '3.9.2', 'unknown'), /Unknown contract schema lane/);
  }
});

test('known legacy schema rejects joint literal drift in both lanes', t => {
  const f = fixture(t);
  const { activeToolRegistrations, registrationInputSchemaAst } = require('../scripts/verify-hosted-contract');
  const name = 'trackly_recover_exact_apply_members';
  const source = fs.readFileSync(path.join(__dirname, '../mcp/apply-tools.js'), 'utf8');
  const entry = activeToolRegistrations(source, 'server.tool', 'local').find(row => row.name === name);
  const schema = registrationInputSchemaAst(source, entry, 'local');
  const original = source.slice(schema.start, schema.end);
  const changed = original.replace('candidateIds must be unique', 'candidateIds must be uni que');
  assert.notEqual(changed, original);
  const contract = { contractVersion: '3.9.2', tools: { [name]: require('../contracts/trackly-apply-tools.json').tools[name] } };
  f.write(f.cliRoot, 'contracts/trackly-apply-tools.json', JSON.stringify({ ...contract, schemaDigests: {} }));
  f.write(f.backendDir, 'contracts/trackly-apply-tools.json', JSON.stringify(contract));
  f.write(f.cliRoot, 'mcp/apply-tools.js', `function registerApplyTools(server) { server.tool('${name}', 'example', ${changed}, handler); }`);
  f.write(f.backendDir, 'src/mcp/server.ts', `registerHostedMcpTool(server, '${name}', 'example', ${changed}, handler);`);
  f.expectedBackendSha = f.commit();
  assert.throws(() => verifyCandidateContract(f), /executable schema drifted/);
});


test('candidate readiness cache cannot start always ready or lose invalidation', () => {
  const { assertCheckpointWriterCallChain } = require('../scripts/verify-hosted-contract');
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/candidate-checkpoint-writer.txt'), 'utf8');
  const changed = source.replace('let upgradeClientActionTypeReadyUntil = 0;', 'let upgradeClientActionTypeReadyUntil = Infinity;');
  assert.notEqual(changed, source);
  assert.throws(() => assertCheckpointWriterCallChain(changed, 'always ready cache', 'candidate-3.9.2'), /upgradeClientActionTypeReadyUntil.*initialization drifted/);
  assert.throws(() => assertCheckpointWriterCallChain(source.replace('const MIGRATION_511_READY_TTL_MS = 30_000;', 'const MIGRATION_511_READY_TTL_MS = Infinity;'), 'unbounded TTL', 'candidate-3.9.2'), /MIGRATION_511_READY_TTL_MS.*initialization drifted/);
  assert.throws(() => assertCheckpointWriterCallChain(source.replace('let migration511InvalidationGeneration = 0;', 'let migration511InvalidationGeneration = NaN;'), 'invalid cache generation', 'candidate-3.9.2'), /migration511InvalidationGeneration.*initialization drifted/);
  assert.throws(() => assertCheckpointWriterCallChain(source.replace('migration511InvalidationGeneration += 1;', ''), 'lost invalidation', 'candidate-3.9.2'), /invalidateMigration511Ready.*locked active semantic AST/);
});


for (const target of ['contracts/trackly-apply-tools.json', 'src/mcp/server.ts']) {
  test(`candidate reads committed backend bytes despite hidden checkout substitution: ${target}`, t => {
    const f = fixture(t);
    const file = path.join(f.backendDir, target);
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace('z.string()', 'z.number()'));
    f.expectedBackendSha = f.commit();
    execFileSync('git', ['-C', f.backendDir, 'update-index', '--skip-worktree', target]);
    fs.writeFileSync(file, original);
    assert.equal(execFileSync('git', ['-C', f.backendDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
    assert.throws(() => verifyCandidateContract(f), target.endsWith('.json')
      ? /shared contract drifted/ : /hosted trackly_example executable schema drifted/);
  });
}


test('candidate rejects a committed symlink even when a clean checkout supplies regular external content', t => {
  const f = fixture(t);
  const target = 'contracts/trackly-apply-tools.json';
  const external = path.join(f.cliRoot, 'external-contract.json');
  const original = fs.readFileSync(path.join(f.backendDir, target), 'utf8');
  fs.writeFileSync(external, original);
  const git = (args, input) => execFileSync('git', ['-C', f.backendDir, ...args], { encoding: 'utf8', input }).trim();
  const blob = git(['hash-object', '-w', '--stdin'], external);
  git(['update-index', '--cacheinfo', `120000,${blob},${target}`]);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'synthetic symlink entry']);
  f.expectedBackendSha = git(['rev-parse', 'HEAD']);
  // Plumbing models a symlink index on Windows without requiring symlink privilege.
  // The checkout still supplies matching JSON, hidden by skip-worktree.
  git(['update-index', '--skip-worktree', target]);
  assert.equal(git(['status', '--porcelain']), '');
  assert.throws(() => verifyCandidateContract(f), /must be a committed regular file/);
});


test('candidate ignores replacement refs that substitute another commit under the expected SHA', t => {
  const f = fixture(t);
  const target = 'contracts/trackly-apply-tools.json';
  const file = path.join(f.backendDir, target);
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('z.string()', 'z.number()'));
  const pinned = f.commit();
  fs.writeFileSync(file, original);
  const replacement = f.commit();
  const git = args => execFileSync('git', ['-C', f.backendDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['checkout', '--detach', pinned]);
  git(['replace', pinned, replacement]);
  git(['read-tree', replacement]);
  git(['update-index', '--skip-worktree', target]);
  fs.writeFileSync(file, original);
  assert.equal(git(['rev-parse', 'HEAD']), pinned);
  assert.equal(git(['status', '--porcelain']), '');
  assert.equal(git(['show', `${pinned}:${target}`]), original.trim());
  f.expectedBackendSha = pinned;
  assert.throws(() => verifyCandidateContract(f), /completely clean|shared contract drifted/);
});
