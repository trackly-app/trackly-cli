# Form integrity gate

Run this gate after each semantic selection and again across the entire form before review.

## Semantic controls

- Open React comboboxes and click the exact list option. Do not inject a value or rely on displayed input text.
- Click native select options, radio labels, and checkboxes through the UI.
- Map booleans semantically: canonical `true` must commit the visible Yes-equivalent and canonical `false` the visible No-equivalent. Never choose a boolean option by index, DOM order, keyboard offset, proximity, or previous control state.
- After selection, verify the selected/checked state from the control, dispatch-completed page state, and visible label. Compare the normalized committed value to the canonical Trackly value; presence alone is insufficient.
- If the committed value is the semantic opposite of the canonical value, stop the sweep, correct the field through a fresh real UI selection, and report a redacted integrity observation.
- Verify that the control’s required error is absent. A visible value beside “This field is required” is a failed field.
- If a stale error remains, reopen and reselect the control. Use non-submitting validation only when the ATS provides it.

## Contact-field integrity

- Compare email and phone to the exact Trackly values after resume parsing and autofill.
- Read both DOM input state and macOS accessibility state.
- Reject duplicate or concatenated values, autofill overlays, placeholder-only text, and values present only in a custom wrapper.
- Recheck when navigation, resume parsing, or a correction banner rerenders the form.

## Final sweep

1. Enumerate every required field on every visible step.
2. Confirm no required field is empty, unknown, or visibly errored.
3. Confirm every required consent checkbox and acknowledgement is truly checked.
4. Search for correction banners, inline errors, invalid attributes, and error summaries.
5. Verify resume filename, education dates, links, and all critical contact fields again.
6. Confirm the Submit button is present but do not click it.

If any field’s committed state cannot be observed, fail the gate and explain which field needs manual review.

## Submission-state reconciliation

- Never retry Submit after a contradictory or duplicate-application response.
- Treat “already applied” and similar banners as provisional until the current ATS route finishes settling.
- Confirm the employer, role, and exact requisition identifier are unchanged, then re-read the final state from that same URL.
- An explicit success state on the exact requisition is authoritative and may be recorded as submitted. Without success or explicit user confirmation, record blocked and leave the job out of Applied.
