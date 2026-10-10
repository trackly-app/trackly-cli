'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
for (const pack of ['skills/trackly-apply', 'plugins/trackly/skills/trackly-apply']) {
  const script = path.join(__dirname, '..', pack, 'scripts/validate-profile-lookup.js');
  const {validate} = require(script);
  const control = (overrides = {}) => ({fingerprint:'a'.repeat(64),schemaFetched:true,contextualProfileFetched:true,state:'answered',required:false,disposition:'fill',committed:true,...overrides});
  const receipt = (...controls) => ({profileRevision:60,controls});
  const cases = [
    ['known answer committed', {}, []],
    ['known answer preserved', {disposition:'preserve'}, []],
    ['known answer asked again', {disposition:'ask'}, ['known_answer_not_committed']],
    ['known answer not verified', {committed:false}, ['known_answer_not_committed']],
    ['compact omission without contextual fetch', {contextualProfileFetched:false,state:'unknown',disposition:'defer_optional'}, ['lookup_incomplete']],
    ['required missing fact', {state:'unknown',required:true,disposition:'ask',committed:false}, []],
    ['optional contextual question', {state:'unknown',disposition:'ask',committed:false}, []],
    ['optional unknown survey', {state:'unknown',disposition:'defer_optional',committed:false}, []],
    ['unavailable lookup asked as missing', {state:'unavailable',disposition:'ask'}, ['unavailable_is_not_unknown']],
    ['redacted lookup blocked', {state:'redacted',disposition:'blocked',committed:false}, []],
    ['live agreement inferred', {state:'live_consent',disposition:'fill'}, ['consent_inference']],
    ['required live agreement deferred', {state:'live_consent',required:true,disposition:'defer_optional'}, ['required_consent_deferred']],
    ['required live agreement asked', {state:'live_consent',required:true,disposition:'ask',committed:false}, []],
    ['answer accidentally included', {answer:'private fixture'}, ['unexpected_control_fields']],
  ];
  for (const [name, overrides, codes] of cases) test(`${pack}: ${name}`, () => assert.deepEqual(validate(receipt(control(overrides))), codes));
  test(`${pack}: all known fields commit before a required question`, () => {
    const controls = Array.from({length:4},(_,i)=>control({fingerprint:String(i+1).repeat(64)}));
    controls.push(control({fingerprint:'f'.repeat(64),state:'unknown',required:true,disposition:'ask',committed:false}));
    assert.deepEqual(validate(receipt(...controls)), []);
    controls[2].committed=false;
    assert.deepEqual(validate(receipt(...controls)), ['known_answer_not_committed']);
  });
  test(`${pack}: malformed and duplicate receipts fail closed`, () => {
    for (const input of [null,{},receipt(),receipt(null),receipt(control(),control())]) assert.ok(validate(input).length);
  });
  test(`${pack}: CLI failure exposes only codes, never answer values`, () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-gate-'));
    try {
      const file=path.join(dir,'receipt.json');
      fs.writeFileSync(file,JSON.stringify(receipt(control({answer:'private-fixture-answer'}))));
      const result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
      assert.equal(result.status,1);
      assert.deepEqual(JSON.parse(result.stdout),{safeToAsk:false,codes:['unexpected_control_fields']});
      assert.equal(result.stderr,'');
      fs.writeFileSync(file,'{broken');
      assert.equal(spawnSync(process.execPath,[script,file],{encoding:'utf8'}).status,1);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}
