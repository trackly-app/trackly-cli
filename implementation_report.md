# Trackly Apply Harness v3 — CLI and Skill

## Summary

- Bumped `trackly-cli` to `0.6.4`, the bundled Trackly Apply skill to `3.0.0`, and the shared Apply tool contract to `2.1.0`.
- Added a browser readiness gate that requires semantic tab discovery, DOM inspection, semantic control interaction, file upload, and committed-state verification before resume preparation.
- Added exact employer/role/ATS/requisition/job/run tab binding and mandatory tab reclamation after handoffs or browser-control interruptions.
- Added explicit profile guidance for employer-scoped facts and consent, global relocation assistance and gender-identity wording, and ephemeral accuracy certifications.
- Added a reusable scenario-coverage reference and final handoff field that report only mechanics actually exercised per run.
- Extended local MCP observation metadata in parity with the hosted backend.

## Safety Properties

- Coordinate-only form filling is forbidden.
- Browser bridge loss preserves existing runs and tab mappings and stops before upload or mutation.
- Resume bytes are prepared only after semantic browser readiness, reducing proof expiry during browser setup.
- Accuracy and truthfulness certifications are reconfirmed per run and never persisted.
- Scenario observations exclude answer values, contact data, OTPs, and page text.
- Frozen batches still preserve exact job-to-run-to-tab mappings and always stop before Submit.

## Verification

- Full CLI suite outside the localhost-restricted sandbox: 151 passed.
- Focused Apply/agent suite: 46 passed.
- Shared backend/CLI contract files are byte-identical.
- `npm pack --dry-run` includes the new scenario reference and produces the expected `0.6.4` package contents.
- `git diff --check` — passed.

## Rollout

- Merge and release the backend and CLI changes together so protocol, hosted MCP, local MCP, and bundled skill stay aligned.
- Existing managed 2.x skills become stale and are upgraded by `trackly agent setup` to `3.0.0`; protocol `compatibleSkillMajor: 3` makes an older skill stop before a live run.
- No npm publish, production deployment, application submission, or job-state mutation was performed in this implementation task.
