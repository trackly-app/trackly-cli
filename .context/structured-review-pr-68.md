# Compensating structured review — PR #68

Reviewed: 2026-07-16 PST
Head: `c5e1ef59646673946552db3183f2e1d0414281ca`

## Why this review exists

CodeRabbit returned an explicit temporary review-limit notice instead of a substantive review. This artifact records the compensating review required by the repository merge gate.

## Scope reviewed

- Version alignment across `package.json`, `package-lock.json`, and `server.json`
- Hosted/local Apply contract parity for protocol `2.1.0`
- Local MCP observation metadata validation and redaction boundaries
- Managed skill upgrade from `2.2.0` to `2.3.0`
- Browser-readiness, tab-reclaim, resume-integrity, profile-scope, certification, and scenario-coverage instructions
- Release notes, packaged files, and automated publishing expectations
- Added and updated tests

## Findings

No remaining P0, P1, P2, or P3 findings.

The changes preserve the no-submit boundary, keep accuracy certifications ephemeral, restrict scenario observations to redacted mechanics metadata, and align the package/runtime/registry versions. The new schema fields are optional and backward compatible.

## Verification

- `npm test` — 151 passed, 0 failed
- GitHub CI — test, docs drift, Claude review, and Amazon Q checks passed
- Independent Codex review covered the exact PR head
- PR is mergeable with clean merge state
