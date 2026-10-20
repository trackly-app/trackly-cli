'use strict';

const assert = require('node:assert/strict');
const { parseExpression } = require('@babel/parser');
const {
  activeToolRegistrations, registrationInputSchemaAst, canonicalSchemaAst,
} = require('./verify-hosted-contract');

const CANDIDATE_PLUGIN_WRAPPER_SOURCE = `function wrapTool(
  handler: (params: any) => Promise<unknown>,
  fallback: string,
  includeStructuredContent = false,
  jobIdKey?: string,
) {
  return async (params: any) => {
    try {
      const result = await handler(params);
      return resultContent(jobIdKey ? normalizeJobResult(result, params[jobIdKey]) : result, includeStructuredContent);
    } catch (error: any) {
      const unavailable = jobIdKey && unavailableJobFromError(
        { ...error, ...error?.responseBody, status: error?.status }, params[jobIdKey],
      );
      if (unavailable) return resultContent(unavailable, true);
      const response = errorContent(error, fallback);
      if (!jobIdKey) return response;
      const payload = JSON.parse(response.content[0].text);
      return { ...response, ...resultContent(jobFailurePayload(error, payload), true) };
    }
  };
}`;

function property(object, name) {
  assert.equal(object?.type, 'ObjectExpression', 'Expected an explicit object');
  assert.ok(object.properties.every(p => p.type === 'ObjectProperty' && !p.computed), 'No dynamic projection fields');
  const matches = object.properties.filter(p => (p.key.name || p.key.value) === name);
  assert.equal(matches.length, 1, `Expected one ${name} property`);
  return matches[0].value;
}

// Candidate-only verification. The historical deployed snapshot and its source
// pins remain unchanged until a separately verified runtime is captured.
function assertJobLookupParity({ localSource, hostedSource, pluginSource }) {
  const lanes = [
    ['local', localSource, 'server.tool', 0],
    ['hosted', hostedSource, 'registerHostedMcpTool', 1],
    ['plugin', pluginSource, 'registerPluginTool', 0],
  ].map(([name, source, callee, index]) => ({
    name, source, registrations: activeToolRegistrations(source, callee, name, index),
  }));
  for (const [tool, key] of [['trackly_get_job', 'id'], ['trackly_get_job_brief', 'jobId']]) {
    let shared;
    for (const lane of lanes) {
      const matches = lane.registrations.filter(r => r.name === tool);
      assert.equal(matches.length, 1, `${lane.name} ${tool} registration missing or duplicated`);
      const registration = matches[0];
      const schema = lane.name === 'plugin'
        ? property(registration.call.arguments[1], 'inputSchema')
        : registrationInputSchemaAst(lane.source, registration, lane.name);
      let shape = schema;
      if (lane.name === 'plugin') {
        assert.equal(schema?.callee?.property?.name, 'strict', `${tool} plugin must reject unknown fields`);
        shape = schema.callee.object.arguments[0];
      }
      const field = property(shape, key);
      assert.deepEqual(Object.keys(Object.fromEntries(shape.properties.map(p => [p.key.name, true]))), [key]);
      assert.equal(field?.callee?.property?.name, 'describe', `${tool} must explain the ID source`);
      assert.match(field.arguments[0]?.value || '', /Trackly job ID.*search|Trackly job ID.*trackly_search_jobs/);
      assert.deepEqual(canonicalSchemaAst(field.callee.object),
        canonicalSchemaAst(parseExpression('z.number().int().positive().safe()')),
        `${lane.name} ${tool} must require a positive safe integer`);
      const canonical = canonicalSchemaAst(shape);
      if (shared) assert.deepEqual(canonical, shared, `${tool} shared job schema drifted`);
      else shared = canonical;
      const wrapper = registration.call.arguments.at(-1);
      assert.equal(wrapper?.callee?.name, 'wrapTool', `${tool} must retain its error wrapper`);
      assert.equal(wrapper.arguments.length, { local: 3, hosted: 5, plugin: 4 }[lane.name]);
      assert.equal(wrapper.arguments.at(-1)?.value, key, `${tool} must opt into job normalization`);
      if (lane.name === 'plugin') {
        assert.equal(wrapper.arguments[2]?.value, true, `${tool} must publish structured content`);
        if (key === 'jobId') {
          assert.deepEqual(canonicalSchemaAst(wrapper.arguments[0]), canonicalSchemaAst(parseExpression(`async ({ jobId }) => {
            const response = await requestApi('GET', \`/api/jobscout/jobs/\${jobId}/plugin-brief\`, authToken);
            const brief = response.brief || response;
            return {
              jobId: brief.jobId,
              isActive: typeof brief.isActive === 'boolean' ? brief.isActive : null,
              companyName: brief.companyName,
              companySignal: {
                openRoleCount: brief.companySignal?.openRoleCount ?? 0,
                pmRoleCount: brief.companySignal?.pmRoleCount ?? 0,
                postedLast7d: brief.companySignal?.postedLast7d ?? 0,
                latestPostedAt: brief.companySignal?.latestPostedAt ?? null,
              },
            };
          }`)), 'Plugin brief must keep its bounded public projection and availability');
        }
      }
    }
  }
}

module.exports = { assertJobLookupParity, CANDIDATE_PLUGIN_WRAPPER_SOURCE };
