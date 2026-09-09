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

The preflight validates local submission inputs and optional unauthenticated discovery. Regression coverage must include invalid shapes, empty skill directories, unequal SVG dimensions, every strict-origin failure, quoted credential assignments, and bounded network/file handling. A passing fixture only proves the guard ran; it does not execute authenticated reviewer scenarios. The narrow shell-assignment scan is not a general secret scanner.

Keep four receipts separate: reviewed and merged source, published npm release with provenance, live backend protocol evidence, and authenticated OpenAI portal acceptance. Preserve the backend PR and portal owner explicitly until each dependent gate is satisfied. Do not archive a still-open PR because its source was implemented or because a checkpoint says terminal.

Verification: `npm test`, `npm run test:contract-fixture`, `npm run test:plugin-submission`, `npm run security:audit`, the canonical PR review gate, and post-merge npm provenance/consumer checks. Use `node scripts/verify-plugin-submission.js --live --strict-origins --json` for public protocol evidence; a failure remains a separate backend/submission dependency.
