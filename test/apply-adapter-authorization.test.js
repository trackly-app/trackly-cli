const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const { z } = require('zod');

for (const [name, suffix, extra] of [
  ['trackly_bind_apply_surface', 'surface-binding', { bindingReason: 'recovery_binding' }],
  ['trackly_record_apply_surface_evidence', 'surface-evidence', {
    ownershipState: 'controller_owned', completeInventory: true, evidenceType: 'surface_inventory_reconciled',
  }],
]) {
  test(`${name} forwards legacy adapter and preserves backend authorization failures`, async () => {
    const filename = path.resolve(__dirname, '../mcp/apply-tools.js');
    const realRequire = createRequire(filename);
    const calls = [];
    const denial = Object.assign(new Error('Unsupported adapter for execution generation'), { status: 409 });
    let authorized = true;
    const request = async (...args) => {
      calls.push(args);
      if (!authorized) throw denial;
      return { success: true };
    };
    const sandbox = {
      module: { exports: {} }, exports: {}, Buffer, URL,
      require: (id) => id === '../lib/client' ? { apiRequest: request } : realRequire(id),
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    const registrations = new Map();
    sandbox.module.exports.registerApplyTools({
      tool: (toolName, description, shape, handler) => registrations.set(toolName, { schema: z.object(shape), handler }),
      registerTool() {}, registerPrompt() {}, registerResource() {},
    }, { wrapTool: fn => fn, mcpUserAgent: 'trackly-mcp/test', throwMcpResourceError: error => { throw error; }, applyApiRequest: request });
    const tool = registrations.get(name);
    const input = tool.schema.parse({
      batchId: 2, memberId: 3, runId: 4, expectedMemberVersion: 1, expectedInspectionEpoch: 1,
      leaseToken: 'lease', browserBindingHash: 'a'.repeat(64), browserSurface: 'codex_in_app',
      adapterCode: 'chrome_mcp', idempotencyKey: 'a'.repeat(16), ...extra,
    });
    assert.equal((await tool.handler(input)).success, true);
    assert.equal(calls[0][1], `/api/jobscout/apply/batches/2/members/3/${suffix}`);
    assert.equal(calls[0][2].adapterCode, 'chrome_mcp');
    assert.equal(calls[0][2].runId, 4);
    assert.deepEqual(Object.keys(calls[0][6]), ['Idempotency-Key']);
    authorized = false;
    await assert.rejects(tool.handler(input), error => error === denial);
    assert.equal(calls.length, 2, 'denied writes must not be retried or relabeled');
  });
}
