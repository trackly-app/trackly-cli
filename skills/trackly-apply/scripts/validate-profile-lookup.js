#!/usr/bin/env node
// Value-free gate: never pass applicant answers or form labels in this receipt.
const fs = require('node:fs');
function validate(receipt) {
  const errors = [];
  if (!receipt || !Number.isSafeInteger(receipt.profileRevision) || receipt.profileRevision < 1 || !Array.isArray(receipt.controls) || !receipt.controls.length) return ['invalid_receipt'];
  if (Object.keys(receipt).some(k => !['profileRevision', 'controls'].includes(k))) errors.push('unexpected_receipt_fields');
  const seen = new Set();
  for (const c of receipt.controls) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push('invalid_control'); continue; }
    if (Object.keys(c).some(k => !['fingerprint','schemaFetched','contextualProfileFetched','state','required','disposition','committed'].includes(k))) errors.push('unexpected_control_fields');
    if (!/^[a-f0-9]{64}$/.test(c.fingerprint || '') || seen.has(c.fingerprint)) errors.push('invalid_control_identity');
    seen.add(c.fingerprint);
    if (c.schemaFetched !== true || c.contextualProfileFetched !== true) errors.push('lookup_incomplete');
    if (typeof c.required !== 'boolean' || typeof c.committed !== 'boolean') errors.push('invalid_control_flags');
    if (!['answered','unknown','redacted','unavailable','live_consent'].includes(c.state) || !['fill','preserve','ask','defer_optional','blocked'].includes(c.disposition)) errors.push('invalid_resolution');
    if (c.state !== 'answered' && c.committed) errors.push('unresolved_control_committed');
    if (c.state === 'answered' && (!['fill','preserve'].includes(c.disposition) || !c.committed)) errors.push('known_answer_not_committed');
    if (['redacted','unavailable'].includes(c.state) && c.disposition !== 'blocked') errors.push('unavailable_is_not_unknown');
    if (c.state === 'unknown' && (c.required ? c.disposition !== 'ask' : !['ask','defer_optional'].includes(c.disposition))) errors.push('unknown_routing_invalid');
    if (c.state === 'live_consent' && !['ask','defer_optional'].includes(c.disposition)) errors.push('consent_inference');
    if (c.state === 'live_consent' && c.required && c.disposition !== 'ask') errors.push('required_consent_deferred');
  }
  return [...new Set(errors)];
}
module.exports = { validate };
if (require.main === module) {
  try {
    const errors = validate(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify({safeToAsk: errors.length === 0, codes: errors}) + '\n');
    process.exitCode = errors.length ? 1 : 0;
  } catch { process.stdout.write('{"safeToAsk":false,"codes":["invalid_receipt"]}\n'); process.exitCode = 1; }
}
