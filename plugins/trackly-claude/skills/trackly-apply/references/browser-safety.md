# Browser safety

Read [claude-in-chrome.md](claude-in-chrome.md) before browser readiness. Its Claude in Chrome tab inventory is the preservation path on Claude.


Contact and address values come only from the current requested canonical
profile projection. Conversation, screenshots, parser output, autocomplete,
and cached values are not authority. Verify rendered live, framework/native, or
accessibility state after events settle; a static `value` attribute is not
proof. Normalize masked phone digits and country code before comparing them to
the canonical value, and require an exact autocomplete option to be committed.

## Readiness gate

Before entering private data, require all of the following:

- The work packet is current and authorizes form mutation.
- The URL is HTTPS.
- The visible employer and role match the approved job.
- The browser opened only the frozen `navigation.requisitionUrl`; the current
  origin and any policy-required ATS tenant match its server-verified policy.
  An exact-origin employer policy requires the exact listed origin, not a tenant.
- After every redirect and for every application iframe, the origin and any
  policy-required ATS tenant were revalidated against that same frozen policy.
- Browser and accessibility state agree on the committed controls.
- A verified tab and unsaved-draft preservation path exists before any mutation: a fresh Claude in Chrome tab inventory that contains the exact bound tab, as described in [claude-in-chrome.md](claude-in-chrome.md).

Stop when any identity, origin, or preservation check is ambiguous. A logo, page title, substring match, familiar visual design, stale tab inventory, or unverified handoff claim is not sufficient authorization.

## Browser-turn preservation

Before ending every browser turn, refresh the Claude in Chrome tab inventory and account for every live bound application tab, as described in [claude-in-chrome.md](claude-in-chrome.md). Never close an application tab, and never end a browser turn after an omitted, partial, inferred or stale inventory without reporting the affected tabs as unverified. Preserve every tab and draft until the user submits or explicitly asks to close it.

## Field integrity

- Inventory the entire form before mutation and again before review. Give every
  visible control one committed or typed-exception accounting row; the row
  count must equal the visible inventory and known omissions must be zero.
- Preserve user edits byte-for-byte unless the user explicitly asks for a rewrite.
- Use semantic labels for selects, radios, and checkboxes; never choose by index or proximity.
- Verify email and phone values exactly and reject duplicate or concatenated values.
- Treat missing date precision as unknown. Ask instead of choosing a default month or day.
- Reconcile all canonical education entries and position-level employment
  records in reverse chronological order. Promotions remain separate records;
  never flatten them into one employer row or invent missing date precision.
- Keep employer-specific, provider-specific, and global answers in their correct scopes.
- Never interpret one consent as permission for a different consent.

## Resume integrity

Prepare a resume only after finding a real attachment control. On Claude, Trackly returns no resume document identity and no download: `trackly_prepare_resume_artifact` with `operation: preview` returns `nextAction: review_in_trackly_web`, and the user reviews their saved original at https://usetrackly.app/profile. Follow the resume section of [claude-in-chrome.md](claude-in-chrome.md). Attach only the exact file the user approved for this application, confirm the displayed filename after attachment, recheck parser-sensitive fields and prove during the final sweep that the attachment is still present. A filename alone never proves which bytes were attached, so the attachment stays unbound and is never recorded as `attached`.

If the user cannot share or name the exact file, report that specific limitation and leave the resume control for the user. Never substitute a different file, switch Trackly accounts or claim an automatic attachment.

## Challenges and final boundary

Do not solve or bypass CAPTCHA, OTP, email verification, credentials, or account creation. Preserve the page for the user. The final Submit control is always a manual boundary, even when the user previously approved filling the application.
