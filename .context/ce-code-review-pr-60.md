# Compound Engineering Review — PR #60

- Scope: `trackly-app/trackly-cli#60`, head `ea5ac93` plus review fixes
- Intent: publish Trackly Apply MCP tools, the sanitized public skill, setup/doctor flows, and secure local resume preparation
- Review mode: compensating structured review because CodeRabbit reported a rate limit
- Lenses: correctness, install atomicity, filesystem safety, tests

## Finding

### P1 — Symlink fallback could expose a partially installed skill

When a client does not support symlinks, setup copied directly into the live client skill directory. A process interruption or copy failure could leave a partial skill that was visible to the agent and then treated as unmanaged on the next setup attempt. This violated the plan's atomic-copy fallback requirement.

Resolution: fallback copies into a randomized sibling staging directory, writes the management marker there, and atomically renames the completed directory into place. Failures remove staging data and never expose the live target. A forced mid-copy failure regression test verifies both properties.

## Validation

- `npm test` — 73/73 passed
- `npm run test:hosted-contract` — passed; hosted/local Apply contract version 1.0.0 matches
- Public skill validator — passed
- `npm pack --dry-run` — passed
- Diff integrity (`git diff --check`) — passed

## Residual risk

Atomic rename depends on staging and destination remaining siblings on the same filesystem, which the implementation guarantees by construction.

## Verdict

Ready from this compensating review after the atomic-install fix. Normal repository CI and required reviewer gates still apply.
