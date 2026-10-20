---
title: Job lookups need availability and retry guidance
date: 2026-10-20
category: integration-issues
module: MCP job lookups
problem_type: integration_issue
severity: medium
symptoms:
  - Expected missing postings appear as tool exceptions
  - Agents repeat unavailable job lookups without a useful next action
root_cause: missing_error_handling
resolution_type: code_fix
applies_when:
  - Changing job detail or brief MCP response handling
tags: [mcp, jobs, availability, errors, retry]
---

A generic HTTP error wrapper cannot decide whether a 404 means an unavailable
posting or a broken route. Normalize only the job endpoint's recognized missing
envelopes (including their explicit failure flag) and availability flags. Preserve unrelated 404s and genuine
service failures as errors. An absent flag is unknown, never evidence of closure.

Keep this decision inside the job tools. Generic HTTP clients and Apply mutations
have different error and retry contracts. Return ordinary structured results for
expected unavailability, with a fixed explanation, retryable=false and another
search as the next step. Closed briefs retain allowed context while omitting obsolete recommended motions and application actions.
For real errors, expose a closed category and bounded retry guidance that honors longer valid API delays and HTTP Retry-After headers, while
retaining the original failure only for the existing content-free telemetry path.

Test through a real MCP client and local HTTP fixture, including recognized job
404s, unrelated route 404s, closed/unknown availability, auth, rate limits and
server failures. Check actual network-request counts and diagnostic events;
expected unavailable results must not emit exceptions. Validate numeric internal
IDs before HTTP, and keep SDK validation failures separate from endpoint errors.

Sanitized stack coordinates alone do not identify a backend response or rejected
argument. Reproduce emitted source using the exact build options and version,
and distinguish the throw-site proof from synthetic input examples. Never report
a fixture's invalid ID as the recovered cause of a historical incident.

Carry Retry-After metadata through the HTTP client without adding retries. Parse
only positive safe integer seconds or a standard HTTP date, choose the longer
body/header delay, and preserve it when applying transient access guidance. Test
these failure branches; healthy responses never exercise them.
