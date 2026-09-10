---
title: Submission preflight is not portal acceptance
date: 2026-09-09
category: workflow-issues
module: Trackly OpenAI plugin submission
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when: Recovering or closing a plugin submission workspace
tags: [openai, plugin, preflight, archive, review, cloud]
---

# Submission preflight is not portal acceptance

PR #142 remained open with thirteen unresolved threads after the Aquatics Cloud workspace was archived. Earlier reports treated passing local tests as completion and treated the separate backend owner as covering all remaining work. The CLI preflight was still absent from main.

Recover ownership and all sessions first, then compare the exact PR head with current main. Preserve unique source and checkpoint intent, but recheck old completion claims. An active backend owner does not own an unfinished CLI PR. Skills are instructions loaded from SKILL.md, not executables whose absence permits silently skipping review.

The preflight validates local submission inputs and optional unauthenticated discovery. Regression coverage must include invalid shapes, empty skill directories, unequal SVG dimensions, every strict-origin failure, quoted credential assignments, and bounded network/file handling. A passing fixture only proves the guard ran; it does not execute authenticated reviewer scenarios. The narrow known-key assignment scan covers standard npm auth/token/password forms as well as shell, JSON and YAML delimiters; it handles punctuation boundaries but is not a general secret scanner. Live-only flags must require explicit live mode so a mistyped command cannot certify an unexecuted probe.

Required domain verification needs an exact expected public token, not merely a token-shaped response. Strict origin probes must preserve the valid OAuth discovery challenge as well as HTTP 401. Validate issuer syntax before deriving discovery URLs, and decode optional PNG/JPEG screenshots and enforce their 706-by-400–860 pixel dimensions separately from square-logo rules. Parse skill frontmatter as YAML rather than matching lines. Cross-check public portal documentation against the installed Codex plugin validator: the current validator accepts both prompt aliases but rejects manifest supportURL, which remains in listing metadata. Preserve that compatibility distinction instead of assuming the two schemas are identical. Require authorization-code support and complete reviewer-environment fields, and keep manifest/listing legal URLs equal. Review the full existing ingestion surface together: manifest fields, skill companion YAML, MCP companion keys, URL syntax and asset paths. A partial schema copy otherwise produces repeated false-green checks. Pin reviewed safety copy rather than claiming a keyword scan understands negation; bind portal prompts to their internal fixture inputs. Branding validation must decode supported PNG/JPEG/WebP content and parse SVG XML, not just trust extensions or a viewBox substring. Keep its square-image limits separate from screenshot dimensions. Require exact HTTP 200 for public legal/listing pages and validate all advertised issuer URLs before selecting a discovery server.

Keep four receipts separate: reviewed and merged source, published npm release with provenance, live backend protocol evidence, and authenticated OpenAI portal acceptance. Preserve the backend PR and portal owner explicitly until each dependent gate is satisfied. Do not archive a still-open PR because its source was implemented or because a checkpoint says terminal.

Verification: `npm test`, `npm run test:contract-fixture`, `npm run test:plugin-submission`, `npm run security:audit`, the canonical PR review gate, and post-merge npm provenance/consumer checks. Use `node scripts/verify-plugin-submission.js --live --strict-origins --json` for public protocol evidence; a failure remains a separate backend/submission dependency.

OAuth authorization and protected-resource metadata must pass the bundled MCP SDK OAuthMetadataSchema and OAuthProtectedResourceMetadataSchema, including optional members, before discovery is considered usable. Every positive and negative reviewer fixture must retain a non-empty string array of forbidden actions (`mustNot` or `forbidden`); a prompt and expected result alone do not preserve the safety evidence.

The `.mcp.json` file contains only `mcpServers`, which contains only `trackly`; that server entry contains only `type` and `url`. Reject packaged Authorization and access_token assignments alongside npm credentials. Public discovery must advertise HTTPS dynamic registration or URL-based client-ID support, with credentialed client interoperability still separate. Check the installed validator’s file-reading behavior before matching its string predicates: Python Path.read_text normalizes CRLF, so its literal LF frontmatter test does not reject raw CRLF files.

Pin the reviewed public listing URL and US audience rather than certifying arbitrary replacement metadata. Optional advertised grant types must include authorization_code. Validate each provided skill dependency descriptor (MCP type, identifier, description, reviewed streamable_http transport and HTTPS URL), not only its enclosing mapping.

Bind skill dependency identifiers/URLs and the support page to the reviewed Trackly destinations. Decode supplied skill icons as images while retaining their own small/non-square allowance; await this validation through the static command. For SVG branding, check intrinsic viewport dimensions as well as viewBox so a square coordinate system cannot hide a rectangular rendered image, and accept numeric pixel dimensions consistently.
