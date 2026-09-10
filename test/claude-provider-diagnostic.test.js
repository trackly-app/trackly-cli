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

test('model probe classifies failures without exposing provider result text', () => {
  const probe = workflow.jobs['model-status'];
  assert.deepEqual(probe.permissions, { contents: 'read', 'id-token': 'write' });
  assert.equal(probe.steps[0].with.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(probe.steps[0].with['persist-credentials'], false);
  assert.match(probe.steps[1].with.claude_args, /--tools=/);
  assert.match(probe.steps[1].with.claude_args, /--max-budget-usd 1/);
  const classifier = probe.steps[2].run;
  const script = `import contextlib,io,json,os,pathlib,tempfile\nsource=${JSON.stringify(classifier)}\nwith tempfile.TemporaryDirectory() as d:\n os.environ['RUNNER_TEMP']=d\n p=pathlib.Path(d)/'claude-execution-output.json'\n for text,expected in [('OAuth token expired synthetic-private','authentication'),('You have hit your limit synthetic-private','quota-or-rate-limit'),('model not available synthetic-private','model-unavailable'),('overloaded_error synthetic-private','provider-transient'),('permission_error synthetic-private','permission'),('synthetic-private','unclassified')]:\n  p.write_text(json.dumps([{'type':'result','subtype':'success','is_error':True,'result':text}]))\n  out=io.StringIO()\n  with contextlib.redirect_stdout(out):exec(source,{})\n  result=json.loads(out.getvalue())\n  assert result=={'category':'model-call-failed','error_categories':[expected]},result\n  assert 'synthetic-private' not in out.getvalue()\n p.write_text(json.dumps([{'type':'result','subtype':'success','is_error':False,'result':'synthetic-private'}]))\n out=io.StringIO()\n with contextlib.redirect_stdout(out):exec(source,{})\n assert json.loads(out.getvalue())=={'category':'model-call-succeeded'}\n`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
