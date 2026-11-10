# Claude in Chrome

Trackly Apply on Claude drives the employer form only through Claude in Chrome, in the user's own Chrome, with `browserSurface: claude_in_chrome` on every call. Trackly's server never opens an employer site.

## Before the first mutation

1. Confirm Claude in Chrome is connected in this conversation. If it is not, stop before starting or resuming work and ask the user to connect it.
2. Open the bound member's frozen `navigation.requisitionUrl` in its own tab and verify identity and origin as the lifecycle contract requires.
3. Take a fresh `tabs_context_mcp` inventory and confirm the exact tab is present with the expected URL and title. Keep a local mapping of job, run, member and tab; never send tab IDs, URLs or page text to Trackly.
4. Compute the `browserBindingHash` locally from that verified binding and bind the member with `trackly_bind_apply_surface`, using a published `<provider>:<major>` adapter code such as `greenhouse:1` or `ashby:1` (never a bare provider or browser name, and never `generic_web_form:1` for a known ATS). If the exact provider code cannot be established, preserve the tab and stop binding.

The inventory covers only the Claude in Chrome tab group. A tab the user dragged out of the group is not proven absent; report it as unverified rather than closed.

## Preservation across turns

- Before ending every browser turn, refresh `tabs_context_mcp` and account for every live mapped application tab, including earlier waves and tabs waiting on the user. Report any tab you cannot find as unverified; never claim it was preserved or closed.
- On a later turn, reclaim each mapped tab, verify its identity and visible form state again before any mutation, and never assume unsaved form state survived.
- A missing tab is recovered within the same run: reopen the frozen requisition URL and bind with `bindingReason: recovery_binding`. Never start replacement work.
- If the inventory fails mid-turn, stop mutating and follow that recovery path without claiming preservation.

## Resume

Claude never receives the resume file or its Trackly identity. The resume reaches the employer form as an attachment the user approves file by file, and it stays unbound:

1. Prepare a resume only after finding a real file input. Call `trackly_prepare_resume_artifact` with `operation: preview`; on Claude it returns `nextAction: review_in_trackly_web`. Ask the user to review their saved original resume at https://usetrackly.app/profile.
2. Ask the user which exact file to attach to this application, and get explicit approval for that file and this application. Approval for one application never covers another, and opening the profile page is not approval.
3. Attach only that file:
   - When the user attaches it themselves in the employer form, wait for them and then verify the visible filename.
   - When the user has shared that exact file with this conversation, and Claude in Chrome's `file_upload` is available for it, Claude may set it directly on the exact `<input type=file>` found by ref. Prove, in order: the semantic file control was found, `file_upload` succeeded, the user-facing filename is committed, and fields the employer's resume parser may have changed were rechecked.
4. Never type a path into a text field, navigate to a file URL, select a second file over a committed input or substitute another file. If the upload fails or the file is not available, leave the control for the user and say so.
5. Never call `trackly_approve_apply_resume` and never record a `resume_attachment` observation as `attached`. A visible filename does not prove which bytes were attached. Certify with `resumeDependency: not_applicable`, and ask the user to confirm the visible filename separately from the truth confirmation.

## After the user submits

Reconcile only from a visible success page in the bound tab or the user's explicit confirmation. Keep the confirmation tab open until `trackly_get_apply_progress` shows the durable submitted state. Close a submitted tab only when the user asks; never close unsubmitted siblings.
