---
title: Claude in Chrome needs direct file proof and MCP-group preservation
date: 2026-11-02
category: integration-issues
module: Trackly Apply browser adapters
problem_type: integration_issue
component: tooling
severity: medium
applies_when: Running Apply from Claude Code with Claude in Chrome on macOS
tags: [apply, claude, chrome, upload, tab-preservation]
---

Claude in Chrome sets files directly on a semantic file-input ref. Requiring a
native chooser rejects that adapter even when it attaches the verified file.
Local contract 3.9.4 adds optional `directFileSet`; explicit support replaces the
two chooser events with a four-stage proof. All semantic targeting, file
verification, committed-filename, parser and final-sweep checks remain required.
An adapter without direct-file support still needs the original chooser proof.

The extension's MCP group contains persistent user Chrome tabs. Refresh
`tabs_context_mcp` before mutation, at turn end and on reclaim. This is a
preservation path, not a handoff receipt or visibility proof. Its inventory is
limited to that group; a tab dragged out is not proven absent. Keep closure
unverified without the complete controller/user union and normal close proof.

ATS binding codes are versioned (`ashby:1`), independent of browser surface.
Scenario-coverage resolution codes are only `passed` or `corrected`; a wrong
code rejects a whole bulk call. New explicitly selected jobs must first be in
Check Later. On Ashby, resolve Yes/No by question-container text rather than
control order or ambiguous discovery labels.

The upload validator is local-only. Keep shared/wire contract 3.9.3 separate
from the new local revision, preserve the historical hosted fixture's version,
and pin the unchanged shared projection digest. A local schema addition does
not establish hosted deployment or installation parity.

Verification: `node --test test/apply-upload.test.js test/mcp-schema.test.js`,
`npm test`, `npm run test:contract-fixture`, and `npm run test:plugin-submission`.

This extends [exact recovery after browser state loss](durable-exact-recovery-after-browser-state-loss.md).
The versioned adapter and resolution-code rules were confirmed in the
2026-11-02 macOS pilot; the backend remains authoritative for acceptance.
