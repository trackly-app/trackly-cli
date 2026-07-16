# Actual scenario coverage

Record only the mechanics exercised on the current application run. Coverage is evidence for improving the reusable harness, not a place for profile values, answers, page text, contact data, or employer-confidential content.

## Observation shape

For each exercised scenario, call `trackly_report_apply_observation` with:

- `runId`: the exact Trackly Apply run.
- `provider`: the normalized ATS.
- `fieldLabel`: a generic mechanics label such as `Run scenario coverage`; never copy private page text.
- `observationType`: `scenario_coverage`.
- `resolutionCode`: `passed`, `corrected`, or `blocked`.
- `metadata.scenarioCode`: one stable code from the list below.
- `metadata.browserSurface`: the semantic browser surface used, such as `codex_in_app`, `chrome_extension`, or `claude_in_chrome`.
- `metadata.resumedAfterHandoff`: whether that run's tab had to be reclaimed after a handoff or browser-control interruption.

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

## Final reporting

List scenario codes separately for every run. Do not report a code because the ATS commonly has that behavior; report it only when it actually occurred and was observed on that run. Mark blocked coverage honestly when committed state could not be verified.
