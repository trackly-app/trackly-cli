# Form integrity gate

Run this gate after each semantic selection and again across the entire form before review.

## Semantic controls

- Open React comboboxes and click the exact list option. Do not inject a value or rely on displayed input text.
- Click native select options, radio labels, and checkboxes through the UI.
- After selection, verify the selected/checked state from the control, dispatch-completed page state, and visible label.
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
