'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const workflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/claude-provider-diagnostic.yml'), 'utf8'));
const job = workflow.jobs['provider-status'];
const source = job.steps[0].run;

test('provider diagnostic is isolated and does not replace the review gate', () => {
  assert.deepEqual(workflow.permissions, {});
  assert.equal(job.steps.length, 1);
  assert.equal(job.steps[0].shell, 'python');
  assert.match(job.if, /head.repo.full_name == github.repository/);
  assert.match(job.if, /author_association/);
  assert.deepEqual(workflow.on.pull_request.paths, ['.github/workflows/claude-provider-diagnostic.yml']);
  assert.equal(job.steps[0].env.REVIEW_PRIMARY, '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
  assert.equal(job.steps[0].env.REVIEW_FALLBACK, '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_FALLBACK }}');
});

test('provider diagnostic only emits bounded status and numeric usage', () => {
  const script = `import json, math, urllib.error\nns={'__name__':'diagnostic_test'}\nexec(${JSON.stringify(source)},ns)\ns=ns['summarize']\nassert s(200,{'five_hour':{'utilization':100},'private':'synthetic-private'})['category']=='quota-window-exhausted'\nassert s(200,{'five_hour':{'utilization':20},'seven_day':{'utilization':45}})['category']=='usage-readable'\nassert s(200,{'five_hour':{'utilization':True},'seven_day':{'utilization':float('nan')}})['category']=='usage-shape-unrecognized'\nassert s(401,{})['category']=='authentication-rejected'\nassert s(403,{})['category']=='usage-scope-or-account-denied'\nassert s(429,{})['category']=='usage-endpoint-rate-limited'\nassert s(200,[])['category']=='invalid-usage-response'\nassert 'synthetic-private' not in json.dumps(s(200,{'five_hour':{'utilization':23,'identity':'synthetic-private'},'private':'synthetic-private'}))\nassert ns['NoRedirect']().redirect_request(None,None,302,None,None,'https://other.example') is None\nassert ns['probe']('')['category']=='binding-unavailable'\nclass Response:\n status=200\n def __enter__(self):return self\n def __exit__(self,*args):pass\n def read(self,n):\n  assert n==65537\n  return b'x'*65537\nclass Opener:\n def open(self,request,timeout):\n  assert request.full_url=='https://api.anthropic.com/api/oauth/usage'\n  assert timeout==20\n  return Response()\nns['urllib'].request.build_opener=lambda *args:Opener()\nassert ns['probe']('synthetic-private')['category']=='usage-response-too-large'\n`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
