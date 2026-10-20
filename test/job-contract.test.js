'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { activeToolRegistrations } = require('../scripts/verify-hosted-contract');
const { assertJobLookupParity } = require('../scripts/verify-job-contract');

function fixture() {
  const localSource = fs.readFileSync(path.join(__dirname, '../mcp/server.js'), 'utf8');
  const jobs = activeToolRegistrations(localSource, 'server.tool', 'local')
    .filter(r => ['trackly_get_job', 'trackly_get_job_brief'].includes(r.name));
  const schemas = jobs.map(r => localSource.slice(r.call.arguments[2].start, r.call.arguments[2].end));
  const hostedSource = jobs.map((r, i) => `registerHostedMcpTool(server, '${r.name}', 'Job', ${schemas[i]},
    wrapTool(authToken, handler, 'Failure', undefined, '${i ? 'jobId' : 'id'}'));`).join('\n');
  const briefHandler = `async ({ jobId }) => {
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
  }`;
  const pluginSource = jobs.map((r, i) => `registerPluginTool('${r.name}', {
    inputSchema: z.object(${schemas[i]}).strict(),
  }, wrapTool(${i ? briefHandler : 'handler'}, 'Failure', true, '${i ? 'jobId' : 'id'}'));`).join('\n');
  return { localSource, hostedSource, pluginSource };
}

test('candidate job contract retains schema bounds, normalization and plugin privacy', () => {
  const sources = fixture();
  assert.doesNotThrow(() => assertJobLookupParity(sources));
  for (const lane of ['localSource', 'hostedSource', 'pluginSource']) {
    assert.throws(() => assertJobLookupParity({ ...sources, [lane]: sources[lane].replace('.safe()', '') }), /safe integer/);
    const wrongKey = sources[lane].replace(/, 'id'\)/, ", 'wrongKey')");
    assert.notEqual(wrongKey, sources[lane]);
    assert.throws(() => assertJobLookupParity({ ...sources, [lane]: wrongKey }), /normalization/);
  }
  assert.throws(() => assertJobLookupParity({ ...sources, pluginSource: sources.pluginSource.replace('.strict()', '') }), /unknown fields/);
  for (const mutation of [
    sources.pluginSource.replace('jobId: brief.jobId,', 'jobId: brief.jobId, contacts: brief.contacts,'),
    sources.pluginSource.replace('companyName: brief.companyName,', 'companyName: brief.contacts,'),
    sources.pluginSource.replace('const brief = response.brief || response;', 'const brief = response.brief || response; if (brief.contacts) return brief;'),
    sources.pluginSource.replace("typeof brief.isActive === 'boolean' ? brief.isActive : null", 'false'),
  ]) assert.throws(() => assertJobLookupParity({ ...sources, pluginSource: mutation }), /bounded public projection/);
});
