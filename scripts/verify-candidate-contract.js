'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  gitOutput, activeToolRegistrations, registrationInputSchemaAst, HOSTED_APPLY_CHECKPOINT_HELPER_AST_SHA256,
  canonicalSchemaAst, verifyCoordinatedBackendCore,
  assertCoordinatedCheckpointHelperSemantics, assertBoundedApplyAdapterValidation,
  directToolRegistrationsInNamedParameterFunction, directHostedToolRegistrationsInNamedFactory,
  exactSchemaDefinition, sha256ExactBytes, parseSchemaExpression,
  assertImportBinding, typescriptConstArrayValues, assertActiveFunctionAstSha256,
} = require('./verify-hosted-contract');
const LOCAL_ONLY = new Set(['trackly_lint_application_text', 'trackly_diagnose_local_path',
  'trackly_validate_apply_tab_keep_set', 'trackly_validate_apply_resume_upload']);

const CANDIDATE_CHECKPOINT_ACTION_SHA256 = '604ccf2ef203d80f022fde2a10d3e471c64724a3c3473569629f05315953cb21';
function assertCandidateCheckpointActionSchema(source, version) {
  assert.equal(version, '3.9.2', 'Candidate checkpoint pin requires contract 3.9.2');
  assertActiveFunctionAstSha256(source, 'applyCheckpointActionSchema', CANDIDATE_CHECKPOINT_ACTION_SHA256, 'candidate checkpoint');
}

function assertSurfaceEnumBindings(localSource, hostedSource, batchSource, constants) {
  const bindings = {
    APPLY_SURFACE_BINDING_REASONS: 'applySurfaceBindingReasons',
    APPLY_SURFACE_EVIDENCE_TYPES: 'applySurfaceEvidenceTypes',
    APPLY_SURFACE_OWNERSHIP_STATES: 'applySurfaceOwnershipStates',
  };
  for (const [name, key] of Object.entries(bindings)) {
    assert.deepEqual(canonicalSchemaAst(parseSchemaExpression(localSource, name, 'local')),
      canonicalSchemaAst(parseSchemaExpression(`const ${name} = APPLY_CONTRACT.constants.${key};`, name, 'expected')),
      `${name} local surface enum binding drifted`);
  }
  for (const [name, key] of Object.entries(bindings)) {
    const imported = name.replace('APPLY_SURFACE_', 'APPLY_BATCH_SURFACE_');
    assert.deepEqual(canonicalSchemaAst(parseSchemaExpression(hostedSource, name, 'hosted')),
      canonicalSchemaAst(parseSchemaExpression(`const ${name} = ${imported};`, name, 'expected')),
      `${name} hosted surface enum binding drifted`);
    assertImportBinding(hostedSource, imported, imported,
      '../services/application-profile/batch-service.js', 'hosted');
    assert.deepEqual(typescriptConstArrayValues(batchSource, imported, 'batch service'), constants[key],
      `${name} backend surface enum values drifted`);
  }
}

function verifyCandidateContract({ cliRoot = path.join(__dirname, '..'), backendDir, expectedBackendSha }) {
  assert.match(expectedBackendSha || '', /^[a-f0-9]{40}$/, 'Expected backend SHA must be a full 40-character commit');
  assert.ok(backendDir, 'Candidate backend directory is required');
  assert.equal(gitOutput(backendDir, ['rev-parse', 'HEAD']).trim(), expectedBackendSha, 'Candidate backend HEAD must match expected SHA');
  assert.equal(gitOutput(backendDir, ['status', '--porcelain', '--untracked-files=all']).trim(), '', 'Candidate backend must be completely clean');
  const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
  const local = JSON.parse(read(cliRoot, 'contracts/trackly-apply-tools.json'));
  const hosted = JSON.parse(read(backendDir, 'contracts/trackly-apply-tools.json'));
  const { schemaDigests, ...shared } = local;
  assert.ok(schemaDigests, 'Local helper schema digests are required');
  shared.tools = Object.fromEntries(Object.entries(shared.tools).filter(([name]) => !LOCAL_ONLY.has(name)));
  assert.deepEqual(hosted, shared, 'Candidate shared contract drifted');
  const localSource = read(cliRoot, 'mcp/apply-tools.js');
  const hostedSource = read(backendDir, 'src/mcp/server.ts');
  const executableSchemas = { local: {}, hosted: {} };
  const normalize = value => value.replace(/\s+/g, '').replace(/,([}\]])/g, '$1');
  for (const [lane, source, contract] of [['local', localSource, local], ['hosted', hostedSource, hosted]]) {
    const registrations = lane === 'local'
      ? [...activeToolRegistrations(source, 'server.tool', lane), ...activeToolRegistrations(source, 'server.registerTool', lane)]
      : activeToolRegistrations(source, 'registerHostedMcpTool', lane, 1);
    for (const [name, declared] of Object.entries(contract.tools)) {
      const matches = registrations.filter(entry => entry.name === name);
      assert.equal(matches.length, 1, `${lane} ${name} must have exactly one registration`);
      let expected = typeof declared === 'string' ? declared : declared[lane];
      // Public object schemas are refined by the locked handler wrappers below.
      if (lane === 'local' && name === 'trackly_start_apply_run') expected = 'startApplyRunInputSchema';
      if (name === 'trackly_certify_apply_batch_truth') expected = lane === 'local' ? 'truthCertificationInputSchema' : 'truthCertificationInputSchema.shape';
      if (lane === 'hosted' && name === 'trackly_start_apply_run') expected = 'startApplyRunSchema.shape';
      const schema = registrationInputSchemaAst(source, matches[0], lane);
      executableSchemas[lane][name] = canonicalSchemaAst(schema);
      assert.equal(normalize(schema.type === 'Identifier' ? schema.name : source.slice(schema.start, schema.end)), normalize(expected),
        `${lane} ${name} executable schema drifted`);
    }
  }
  // Contract strings historically strip whitespace, including inside literals.
  // Compare executable ASTs as well so that serialization cannot hide a drift.
  for (const name of Object.keys(hosted.tools)) {
    if (['trackly_verify_prepared_resume', 'trackly_start_apply_run', 'trackly_certify_apply_batch_truth'].includes(name)) continue;
    assert.deepEqual(executableSchemas.local[name], executableSchemas.hosted[name], `${name} shared executable AST drifted`);
  }
  assertBoundedApplyAdapterValidation(localSource, 'local');
  assertBoundedApplyAdapterValidation(hostedSource, 'hosted');
  for (const method of ['tool', 'registerTool']) {
    directToolRegistrationsInNamedParameterFunction(localSource, 'registerApplyTools', 'server', method, 'local');
  }
  const pluginLock = JSON.parse(read(cliRoot, 'plugins/trackly/skill-lock.json'));
  directHostedToolRegistrationsInNamedFactory(hostedSource, 'createTracklyMcpServer',
    'registerHostedMcpTool', 'hosted', pluginLock.hostedMcpToolAllowlist);
  const dependencySources = {
    localMcpApplyTools: localSource,
    hostedMcpServer: hostedSource,
    hostedApplyExecutionContract: read(backendDir, 'src/services/application-profile/apply-execution-contract.ts'),
  };
  for (const section of ['namedApplySchemaSha256', 'namedApplyDependencySha256']) {
    for (const [lane, definitions] of Object.entries(pluginLock.publicExecutableContract[section])) {
      for (const [name, digest] of Object.entries(definitions)) {
        assert.equal(sha256ExactBytes(exactSchemaDefinition(dependencySources[lane], name, lane)), digest,
          `${lane} ${name} retained schema dependency drifted`);
      }
    }
  }
  const fixture = {
    localContract: local, hostedContract: hosted, localApplySource: localSource, hostedApplySource: hostedSource,
    hostedBatchServiceSource: read(backendDir, 'src/services/application-profile/batch-service.ts'),
    hostedCheckpointContractSource: read(backendDir, 'src/services/application-profile/apply-checkpoint-contract.ts'),
    hostedPluginContract: JSON.parse(read(backendDir, 'contracts/trackly-plugin-tools.json')),
    pluginLock,
    hostedPluginSource: read(backendDir, 'src/mcp/plugin-server.ts'),
  };
  assertSurfaceEnumBindings(localSource, hostedSource, fixture.hostedBatchServiceSource, local.constants);
  verifyCoordinatedBackendCore(fixture);
  assertCandidateCheckpointActionSchema(hostedSource, local.contractVersion);
  assertCoordinatedCheckpointHelperSemantics({
    ...fixture,
    checkpointWriterGeneration: 'candidate-3.9.2',
    expectedHostedDigests: {
      ...HOSTED_APPLY_CHECKPOINT_HELPER_AST_SHA256,
      // The candidate adds client/upgrade_required; deployed snapshot pins stay unchanged.
      applyCheckpointActionSchema: CANDIDATE_CHECKPOINT_ACTION_SHA256,
    },
  });
  return { contractVersion: local.contractVersion, backendSha: expectedBackendSha, sharedTools: Object.keys(hosted.tools).length };
}
module.exports = { verifyCandidateContract, assertSurfaceEnumBindings, assertCandidateCheckpointActionSchema };
if (require.main === module) {
  const result = verifyCandidateContract({ backendDir: process.env.TRACKLY_BACKEND_DIR, expectedBackendSha: process.env.TRACKLY_BACKEND_SHA });
  console.log(`Candidate-only contract parity passed: Apply ${result.contractVersion}, backend ${result.backendSha}, ${result.sharedTools} shared tools. This is not deployed-runtime provenance or release approval.`);
}
