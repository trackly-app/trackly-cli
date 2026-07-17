# Structured review — PR #70

## Scope

Independent review of Trackly CLI 0.7.0, public Trackly Apply skill 4.0.0, local MCP contract 3.0.0, resume proof flow, ATS playbooks, browser integrity rules, scenario evidence, package contents, and public-data sanitization.

## Findings resolved before commit

- Made browser readiness and exact run/tab binding precede resume preparation.
- Kept resume uploads conditional on a semantically identified Resume/CV control.
- Required exact path, filename, size, hash, run, expiration, visual confirmation, and immediate pre-attach verification.
- Delegated ATS support, origin authorization, and tenant parsing to the backend protocol.
- Required the skill to execute extraction, exact host depth, locale, decoding, normalization, and fail-closed tenant rules exactly.
- Removed blocked scenarios from passed/corrected coverage and made them block the run instead.
- Marked YC Work at a Startup manual-only and corrected the guided-provider count.
- Preserved manual submission, OTP/human-verification handoff, voice calibration, education precision, semantic booleans, final consent, and deterministic batch behavior.

## Verification

- Independent CLI/skill review: clean, no remaining actionable findings.
- Complete CLI suite: 157 tests passed outside the local-loopback sandbox before the final documentation-only refinements.
- Final focused Apply/agent/package suite: 69/69 passed.
- `npm pack --dry-run` contains 18 intended public files and no private profile data or absolute user paths.
- `git diff --check` passed.
- Hosted and local MCP tool-contract JSON files are byte-identical at contract version 3.0.0.

## Residual boundaries

- Guided mode stops when committed state, origin, or tenant cannot be verified.
- Manual-only providers are not started or mutated.
- The skill always stops before Submit.
