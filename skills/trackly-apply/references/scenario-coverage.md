# Actual scenario coverage

Record only the mechanics exercised on the current application run. Coverage is evidence for improving the reusable harness, not a place for profile values, answers, page text, contact data, or employer-confidential content.

## Observation shape

For each exercised scenario, call `trackly_report_apply_observation` with:

- `runId`: the exact Trackly Apply run.
- `provider`: the normalized ATS.
- `fieldLabel`: a generic mechanics label such as `Run scenario coverage`; never copy private page text.
- `observationType`: `scenario_coverage`.
- `resolutionCode`: `passed` or `corrected`. A blocked scenario is not scenario-coverage evidence; record the Apply run as `blocked` and optionally report a redacted `integrity_failure` observation.
- `metadata.scenarioCode`: one stable code from the list below.
- `metadata.browserSurface`: the semantic browser surface used, such as `codex_in_app`, `chrome_extension`, or `claude_in_chrome`.
- `metadata.committed`: `true` only after the scenario's actual committed state is observed. Every `passed` or `corrected` scenario requires `true`.
- `metadata.resumedAfterHandoff`: whether that run's tab had to be reclaimed after a handoff or browser-control interruption.

`browser_reclaim` is the exception to the observation shape above: attest it once with `observationType: browser_ready`, `metadata.scenarioCode: browser_reclaim`, `metadata.browserSurface`, `metadata.browserBindingHash`, and `metadata.committed: true`. Do not send a duplicate `scenario_coverage` row for browser reclaim.

## Stable scenario codes

- `browser_reclaim`: exact job/run/tab binding was discovered or reclaimed and verified.
- `resume_upload`: the verified exact resume was attached and the employer-facing filename matched.
- `resume_parser_recheck`: contact or profile fields were rechecked after resume parsing or autofill.
- `semantic_boolean_commit`: a Yes/No control was selected and verified by semantic value.
- `custom_select_commit`: a React or native select committed the intended canonical value.
- `multi_step_navigation`: the form crossed one or more steps and earlier state was reverified.
- `free_text_voice`: a free-text answer passed the saved-voice and factual-integrity gate.
- `required_error_sweep`: every required field and visible error surface was checked.
- `final_consent`: the final certification, acknowledgement, or consent control was verified.
- `handoff_reclaim`: the browser tab was reclaimed after a context or control handoff.
- `critical_contact_integrity`: every present canonical contact control was exact after parsing/autofill and the form inventory proved that no required contact field was omitted.
- `manual_submit_boundary`: the agent reached an observable final review boundary and stopped without activating Submit or its equivalent.

The last two codes are universal review proofs and must be reported for every review-ready run. Their observations are value-free: never include email, phone, applicant name, answer values, page text, or local paths.

## Final reporting

List scenario codes separately for every run. Do not report a code because the ATS commonly has that behavior; report it only when it actually occurred and was observed on that run. A visible value is not proof of committed state. When committed state cannot be verified, omit passed/corrected coverage for that scenario and record the run as blocked.
