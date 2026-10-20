---
title: Analytics instrumentation must preserve strict MCP schemas
category: integration-issues
module: MCP analytics
component: observability
date: 2026-10-19
problem_type: integration_issue
severity: medium
symptoms:
  - Unsupported search arguments reached the handler without an MCP validation error
  - Unknown controls disappeared when optional analytics context was installed
root_cause: missing_validation
resolution_type: code_fix
applies_when:
  - Adding fields to registered MCP tool schemas
  - Wrapping tools with optional analytics context
tags: [mcp, analytics, zod, strict-schema, sdk]
---

The MCP SDK's registered-tool `update({ paramsSchema })` shape API rebuilds an
object schema. With SDK 1.32.1 this loses the strict/catchall policy of a real Zod
object. An unsupported search control can therefore disappear before the
handler, leaving a successful response to a different request.

Extend an existing object schema with its own `extend` method and update the
callback separately. Preserve the shape-based path only for SDK-created empty
Mini schemas that do not expose `extend`. Strip the optional analytics context
before calling the business handler, while retaining all original validation.

The regression must use a real MCP client and linked server transport with
analytics enabled. A schema-only assertion before instrumentation cannot expose
this defect. Send an unknown argument and assert an MCP error plus zero handler
calls. Also check that valid calls, optional context, strict/catchall policies,
and tools without input fields remain compatible.

Verification: `node --test test/mcp-analytics.test.js test/mcp-schema.test.js`
and `npm test`. The real transport regression failed with the old instrumentation
and passed after the fix. Keyword telemetry continues to retain length only;
this change does not permit raw query or context storage.
