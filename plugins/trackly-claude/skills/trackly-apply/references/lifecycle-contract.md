# Apply lifecycle contract on Claude

Trackly owns one resumable, wave-by-wave Apply lifecycle. Do not recreate it from lower-level calls. Every argument named here comes from the latest Trackly result; never invent, reuse or adjust one.

## Profile facts for a form

Setup reads (`trackly_get_profile_onboarding`, `trackly_get_application_profile`) identify missing and saved facts by canonical key and public label. After the bound snapshot shows which canonical facts a form needs, request only the minimal intersection with saved keys through `profileKeys` on `trackly_get_apply_snapshot`. Office-only keys go in `officeProjections` for the exact member and canonical `companyId:office-identity`, and are accepted only from the matching `memberOfficeProfiles` entry; never reuse an office fact for another member, employer or office. A sensitive key additionally needs the sensitive read permission. Never request every field or infer an answer from its key or label.

The snapshot is a strict projection: only requested fields appear, resume data is reduced to availability booleans, and each member's frozen `navigation` packet is the only authorized requisition identity and origin policy. Snapshot and progress reads renew Trackly's private work lease, so they need Apply write permission even though they change no application.

## Establish bound work

Accessible-first is a hard rule inside a wave. Do not open known sign-in, account-creation, OTP or pre-form CAPTCHA work while an accessible member remains. Unknown access permits only a minimal non-mutating probe. Record a detected gate with `trackly_record_apply_dispositions` (`source: live_probe`, `probeOnlyNoDraft: true` when no draft was started) at the current `revision`, then read progress again.

Call `trackly_start_or_resume_apply` with `target`, a fresh `idempotencyKey`, `browserSurface: claude_in_chrome` and, for selected jobs, exact ordered `jobIds`. With `targetMismatch: false`, Trackly has started or resumed the execution and prepared and claimed its current wave: use only the returned `executionId`, `revision`, `batchId`, `memberIds` and `nextAction`.

Trackly owns and renews the private work lease on every call. No tool accepts or returns a lease token. Never request, infer, store or send one.

For an exact `jobIds` request, `targetMismatch: true` is a stop: report the mismatch and keep everything as it is. Only a count-only request may follow `nextAction: use_active_target` (start again with `activeTarget`, the same surface and a fresh key). `nextAction: restart_after_reauthorization` means the execution belongs to another connection: do not read or change its work; after explicit user confirmation, call `trackly_stop_apply` with the returned `executionId` and `revision` and `reasonCode: execution_restarted`, verify it stopped, then start again with a fresh key.

Never call a snapshot with empty `memberIds`. Act on `nextAction`:

- `advance_or_refresh`: call `trackly_get_apply_progress` with the `executionId` and obey its state.
- `access_review`: show the exact `proposedWave.members` in `memberPosition` order with their `jobId` and `accessKnowledge` reason; open nothing. Missing, noncontiguous or mismatched member identity blocks approval. Only after the user explicitly approves that exact ordered set, call `trackly_advance_apply_execution` with the current `revision`, `accessReviewApproval.jobIds` in the same order, `accessReviewApproval.approvalHash` set to `proposedWave.approvalHash`, `browserSurface: claude_in_chrome` and a fresh key. Never synthesize the hash or infer approval from a general request to apply. An empty proposal (all candidates deferred) is not approvable: report it and stop. Never reapprove a wave after `createdWave: true`.
- `manual_review`: preserve the current review state and hand it off without inventing work.
- `complete`: stop browser work and report completion.
- `work_ready` or `continue_current_wave` with nonempty `memberIds`: continue below.
- Any other value: stop rather than inventing work.

Deferments are listed and changed only through `trackly_list_apply_access_deferments`, `trackly_defer_apply_access` and `trackly_clear_apply_access_deferment`, using a stable `jobId` and scope `job`, `company` or `provider` (or the listed `defermentId` to clear one the user selects). Clearing a deferment is not wave approval. An active deferment means no browser work on that job.

With nonempty `memberIds`, first call `trackly_get_apply_snapshot` with the returned `executionId`, the exact `memberIds` and `browserSurface: claude_in_chrome`, omitting `profileKeys`. Choose the minimal keys from its form requirements, then request the same snapshot with only those keys.

Before the first browser mutation for each member, call `trackly_bind_apply_surface` with its current `batchId`, `memberId`, `runId`, `expectedMemberVersion`, `expectedInspectionEpoch`, `browserSurface: claude_in_chrome`, a published `<provider>:<major>` adapter code, the verified `browserBindingHash`, `bindingReason` and a fresh key. Continue only when the returned binding matches. Every `trackly_record_apply_observations` call also needs its own fresh key.

Before any private form data, call `trackly_get_job` for every distinct `jobId`, open only the member's frozen `navigation.requisitionUrl` and require `originPolicy.authorized: true`. Compare the live page with the frozen company, title, requisition URL, authorized origins and any ATS provider, host suffix, tenant and tenant rule the policy supplies; do not infer any identity field. For a direct-employer exact-origin policy, require only the exact listed origin. Revalidate after every redirect and for every application iframe. Any mismatch is a hard stop.

Resume a parked member only after an explicit user request for that exact member: `trackly_resume_parked_apply_member` with the current identifiers and revision, `browserSurface: claude_in_chrome`, `explicitUserResume: true` and a fresh key. Treat the returned revision, member version, inspection epoch and fresh-probe requirement as authoritative.

When an advance succeeds, its returned `batchId`, `memberIds` and `nextAction` are the next wave. Never reconstruct it from earlier state.

## Resume on Claude

Claude never receives a Trackly resume document identity: `trackly_prepare_resume_artifact` with `operation: preview` returns `nextAction: review_in_trackly_web`, and without an operation it returns `nextAction: attach_resume_manually`. So on Claude:

- Never call `trackly_approve_apply_resume`. It needs the exact `resumeId`, `resumeSha256`, `resumeFilename` and `resumeSizeBytes` that only a Trackly preview returns, and copying values from anywhere else would approve a document nobody reviewed.
- Never record a `resume_attachment` observation with `resolutionCode: attached`.
- Certify with `resumeDependency: not_applicable` and no resume identity.

The attachment itself follows [claude-in-chrome.md](claude-in-chrome.md): the user reviews the saved original on the website and approves one exact file for this application; the attachment stays browser-local and unbound.

## Atomically certify review readiness

`trackly_certify_review_ready` is the only transition from a filled member to durable review-ready state. Use the current Trackly values for `runId`, `batchId`, `memberId`, `inspectionEpoch` and `expectedMemberVersion`, plus:

- a fresh `idempotencyKey`;
- `knownFieldsCommitted: true` only after every known field is visibly committed;
- `explicitUserTruthConfirmed: true` only after the user confirms this exact complete application;
- `answerSnapshotHash` for the value-free answer snapshot and `wordingFingerprint` for the exact certification wording shown to the user;
- `resumeDependency: not_applicable` with every resume identity field omitted.

Trackly records the review checkpoint, truth certification and review-ready outcome together. Never send filenames, paths, file contents, answer values or server-owned internals. Report success only when the result shows `reviewReady: true`.

## Atomically reconcile a manual submission

After the user (never Claude) activates Submit, call `trackly_reconcile_manual_submission` with the current `runId`, `batchId`, `memberId`, `expectedMemberVersion`, positive `inspectionEpoch`, `browserBindingHash`, a value-free `evidenceFingerprint` and a fresh key. Use `confirmation: success_page` only when the bound tab visibly shows the employer's success state, or `confirmation: user_confirmation` with `explicitUserConfirmed: true` only when the user explicitly confirms they submitted. Keep the confirmation tab open and read progress until Trackly returns the durable submitted state.

Never reconcile from an intent to submit, a click attempt, navigation alone or inference.

## Maintenance pacing

On `code: maintenance_mode` or HTTP 503, preserve every bound tab and stop mutations. Results on Claude carry no retry time, so do not poll: ask the user to resume later, then make a single `trackly_get_apply_progress` read when they do.
