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
  const constants = Object.fromEntries(Object.values(bindings).map(key => [key, ['expected']]));
  const local = Object.entries(bindings).map(([suffix, key]) => `const APPLY_SURFACE_${suffix} = APPLY_CONTRACT.constants.${key};`).join('\n');
  const hosted = `import { ${Object.keys(bindings).map(s => `APPLY_BATCH_SURFACE_${s}`).join(', ')} } from '../services/application-profile/batch-service.js';\n`
    + Object.keys(bindings).map(s => `const APPLY_SURFACE_${s} = APPLY_BATCH_SURFACE_${s};`).join('\n');
  const batch = Object.keys(bindings).map(s => `export const APPLY_BATCH_SURFACE_${s} = ['expected'] as const;`).join('\n');
  assert.doesNotThrow(() => assertSurfaceEnumBindings(local, hosted, batch, constants));
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
  assert.throws(() => verifyCandidateContract(f), /shared executable AST drifted/);
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
