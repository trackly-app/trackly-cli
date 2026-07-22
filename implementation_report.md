# Trackly Apply Cross-ATS Guided Mode — CLI and Skill

## Summary

- Bumped `trackly-cli` to `0.7.0`, the bundled Trackly Apply skill to `4.0.0`, and its minimum Apply protocol to `3.0.0`.
- Bumped the shared Apply MCP tool contract to `3.0.0`; committed-state evidence is now required on observation calls.
- Replaced the static three-provider boundary with backend-owned `full`, `best_effort`, `guided`, and `blocked` capabilities.
- Added constrained guided-mode instructions for enterprise and mid-market ATS forms. Unknown employer forms require a backend-authorized verified company domain; LinkedIn-hosted and unverified forms remain manual-only.
- Preserved the non-mutating browser readiness gate: semantic tab discovery, DOM inspection, semantic control interaction, file-input discovery, and committed-state verification happen before resume preparation; the real upload still waits for exact-file confirmation.
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
- Any non-null queue execution blocker stops before run creation, and every required scenario needs same-run passed/corrected evidence before review.
- Redirects and data-receiving iframe origins and ATS tenants must remain inside the backend-issued origin policy. The skill executes the backend's declarative extraction, exact-host-depth, locale, decoding, normalization, and fail-closed semantics without maintaining its own ATS tenant parser.
- Custom employer forms never reuse the shared `generic_web_form` provider answer scope.
- Frozen batches still preserve exact job-to-run-to-tab mappings and always stop before Submit.

## Verification

- Full CLI suite: 157 passed.
- Shared backend/CLI contract files are byte-identical.
- `npm pack --dry-run` includes the cross-ATS playbook and produces the expected `0.7.0` package contents.
- `git diff --check` — passed.

## Rollout

- Merge and release the backend and CLI changes together so protocol, hosted MCP, local MCP, and bundled skill stay aligned.
- Existing managed 3.x skills become stale and are upgraded by `trackly agent setup` to `4.0.0`; protocol `compatibleSkillMajor: 4` prevents older clients and pre-3.0 runs from entering guided execution.
- No npm publish, production deployment, application submission, or job-state mutation was performed in this implementation task.

---

# Controlled-access rollout guidance — CLI and local MCP

## Outcome

- Google OAuth now renders a specific limited-rollout response when the backend
  returns an invitation denial, while preserving the callback CSRF check.
- CLI API calls and local MCP tools normalize every structured invitation and
  access-capacity failure to the same actionable guidance and early-access URL.
- Unauthenticated help distinguishes existing-member OAuth/API-key options
  from the private-invite path for new members.
- README and MCP tool documentation describe the controlled rollout without
  implying that repeated sign-in or API-key creation can bypass enrollment.

## Verification

- Full Node test suite: 168 passed, 0 failed.
- Local MCP stdio smoke and CLI help smoke: passed.
- `git diff --check`: passed.

No package version was bumped and no npm publish was run; release remains a
separate reviewed merge-to-main action.
