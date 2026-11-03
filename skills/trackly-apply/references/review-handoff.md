# Review handoff

## Live progress receipt

Send this after every durable milestone and at least once every 60 seconds during active work:

```text
Current operation:
Last durable milestone:
User action now: wait / act
Next milestone / next update:
Delay source: browser / Trackly / ATS / user
Funnel: target=; ready=; submitted=; filling=; awaitingAnswer=; authParked=; excluded=; remaining=
```

Use the compact execution snapshot as authority. Give a bounded next-update estimate, not an invented overall completion time.

## Deterministic operator receipts

Every handoff names the browser surface and authoritative funnel. Use the
matching template; do not improvise internal routing language.

Every operator update also reports three independent state lines:

```text
Employer application state: not opened / access probed / form reached / partially filled / needs answers / review state prepared / manually submitted / ATS success observed / blocked
Trackly state: execution + batch + member lifecycle + job state + inspection epoch + profile revision + resume/truth/submission receipts
Browser state: no known tab / controller-owned / user inventory / visible / durable handoff proven / missing / closure unverified / closed verified
```

No state in one system implies a state in another. In particular, a Trackly
`review_ready` member does not prove the employer draft is visible, and a
visible form does not prove a durable checkpoint. When visibility is
unverified, say so, preserve the exact binding, and do not claim a review-ready
handoff or tell the user to submit.

A verified handoff receipt must carry the exact browser-binding hash, a
value-free evidence fingerprint, and whether the proof came from the adapter's
exact-tab presentation action, an exact tab-bound user-visible handoff receipt,
or a durable handoff receipt. A complete tab inventory proves reachability, not
visibility. Bind those same fields into the validator's expected context; never
substitute a self-asserted visibility boolean.

### Recovery

```text
Recovery in progress — not submitted
Completed: exact Trackly source and user-confirmed candidate set recovered
Tab restored: yes/no
Form state restored: yes/no
Current mutation authority: yes/no
Unresolved:
Your next action: wait / inspect / answer
Resume: exact approved resume / no attachment / manual upload required
Browser surface:
Funnel:
My next action:
```

### Upload requires the user

```text
Application preserved — resume upload requires you
Completed:
Unresolved: browser surface cannot prove the required attachment stages
Your next action: attach the exact approved resume and confirm the committed filename
Resume: exact approved resume
Browser surface:
Funnel:
My next action: recheck parser-modified fields, finish integrity sweep, stop at review
```

### Submission reconciled

```text
Submission confirmed and reconciled
Completed: success evidence recorded; member=submitted; job=applied_confirmed
Unresolved: tab cleanup pending / none
Your next action: none
Resume: exact approved resume / no attachment
Browser surface:
Funnel:
My next action: verify authorized tab disposition only
```

## Approval scope receipt

Before persisting a broad statement such as “always,” show which separate categories it will update: personal facts, consent choices, writing preferences, resume approval, and truthfulness certification. Never let approval of one category authorize another. Consolidate genuinely unknown questions into one packet after filling everything already known. Explain legal terms in plain language using the protocol glossary; do not expose internal action codes or routing labels.

For one application, provide this compact block and stop only after the exact
review tab has documented visibility proof:

```text
Ready for your review — not submitted

Trackly saved the verification state. The employer's live draft still exists
only in the open browser tab and may be lost if that tab is closed or reloaded.

Company / role:
ATS / URL:
Resume:
Resume visual confirmation: yes/no
Resume exact local path:
Resume fingerprint / size:
Resume confirmation run / expiration:
Critical contact values verified: yes/no
Authorization / sponsorship:
Compensation answer:
Education:
EEO / consent choices:
Custom answers:
Integrity sweep: pass/fail
Manual-submit boundary verified: yes/no
Actual scenario coverage:
Items requiring your attention:

Please review the live form and click Submit manually.
```

If the form reached its verified review state but the adapter cannot prove the
exact review tab visible or issue an exact user-visible handoff receipt, do not
use the block above and do not tell the user to submit. Preserve the tab and
use this separate block:

```text
Review state prepared — visibility not verified

Company / role:
ATS:
Resume:
Integrity sweep: pass/fail
Actual scenario coverage:
Recovery needed: reclaim and visibly reveal the exact review tab

Do not submit from this handoff. I must first prove the live review form is
visible on your browser surface.
```

For a frozen batch, first summarize unresolved human actions, then provide one
review block per run that reached `review_ready`. Continue processing other
members before presenting the first-pass handoff.

For an accessible execution, show the server-authoritative funnel before the
per-run review blocks: `target`, `durablyReviewReady`, `submitted`,
`reservedReviewSlots`, `currentlyFilling`, `awaitingAnswer`, `authParked`,
`excluded`, `conflicted`, `attempted`, `remainingCandidates`,
`queueExhausted`, `targetReached`, and `nextAction`. Do not infer these counts
from visible tabs. Authentication-gated and excluded jobs remain in Check Later
and are listed separately; they are not failed applications and do not consume
the target.

Use plain language around that funnel. Label `durablyReviewReady` as “verified
and waiting for your manual submission,” while retaining the exact server key
only in the authoritative count line. Never imply that Trackly stored the ATS
form contents or can recreate the employer draft.

## Grouped actions

Group recoverable actions in this order:

1. company;
2. role;
3. run;
4. action type.

Show the stage and what the user must do, without copying raw form questions or
private values into Trackly observations. Separate credentials, legal choices,
artifacts, and unknown reusable answers. Later handoffs contain only newly
revealed conditional deltas.

## Batch review table

Include one row per frozen member:

```text
Job ID | Run ID | Browser label | ATS | State | Human actions | Evidence
```

The browser label may help the user find a visible tab, but raw tab identifiers
stay local and out of Trackly. For each review-ready run, include its current
inspection epoch, resume-content approval status, per-run attachment proof,
truth certification status, required scenario coverage, and integrity result.
Submission evidence and closure evidence remain separate and are normally
empty until after the user's manual Submit.

After the user submits, record one typed `user_confirmation` only when the user
explicitly says they submitted. Prefer a current-epoch `success_page` proof when
the controlled browser visibly shows success. A provider receipt may come from
the application surface, evidence supplied by the user, or the explicitly
consented external-agent preflight in
[inbox-receipt-preflight.md](inbox-receipt-preflight.md). Trackly never accesses
the mailbox. Hash the proof locally and never send confirmation text, page text,
receipt identifiers, message metadata, or URLs as evidence.

For the local MCP `claude_in_chrome` path, follow the post-submit closeout
sequence below instead of the outcome-before-close ordering in this paragraph.
For other paths, after either success-page evidence or explicit confirmation, record
`submitted`, refetch, and require both member `submitted` and job
`applied_confirmed`. Only then may the saved cleanup preference authorize
closing the exact mapped tab. Verify controller/user inventory absence and
record closure evidence before finalizing the member. Tab closure never becomes
submission evidence.

Do not claim the batch is ready until every frozen member is either
`review_ready`, has an explicit resumable human action, is user-revoked, or has
a terminal trust/observability blocker.

Do not make ready siblings wait for an unresolved member. Hand off every
truth-certified `review_ready` subset as soon as it is durable, keep its tabs
open for manual submission, and list remaining human actions separately.
Members that become ready later require a new certification for the exact
then-current `review_ready` subset.

## Group submission reconciliation

A broad statement such as “I submitted all of them” applies only to one
explicit review-handoff receipt. Call `trackly_list_apply_review_handoffs` for
the execution, then resolve it to the receipt the user names or to the sole
active receipt returned by Trackly. If multiple receipts could
match, ask the user to choose; never fan the statement across executions or
tabs.

Inspect every member in the selected receipt and classify exactly one of:
`detected`, `user_confirmed`, `unresolved`, or `contradictory`. Use
provider-positive evidence only:

- Greenhouse: a same-requisition thank-you page, confirmation route, or
  semantic success state;
- Ashby: a same-requisition explicit application-success banner or page,
  including when the route does not change; and
- Lever: a same-requisition confirmation redirect or semantic success state.

An unchanged URL or page title is never evidence that submission failed. Build
any local `DetectedSubmission` only from a versioned provider strategy, the
handoff/member identity, current inspection epoch, evidence type, confidence,
and a value-free fingerprint derived from those identifiers. Never hash DOM
text, URLs, local paths, or raw tab IDs into that record.

If a rediscovered receipt is `partially_reconciled`, preserve every member that
already has a stored reconciliation result and inspect only members whose
stored result remains `unresolved`. Do not replay the original claim with a
partial member list: the claim receipt is an immutable exact-set idempotency
record. Record later positive evidence and submitted outcomes through the
normal per-member outcome path, naming the receipt and only its unresolved
members in any follow-up confirmation.

Call `trackly_claim_apply_review_handoff` with the exact receipt and a
classification for every member. Write submission evidence and outcomes only
for `detected` and `user_confirmed`. Ask one consolidated question containing
only the `unresolved` members. Preserve every `contradictory` member and its
tab without an outcome. Refetch and require member `submitted` plus job
`applied_confirmed` before any authorized closure.

Do not include restricted answers in chat unless needed for the user’s review.
Never include credentials, an OTP, or a CAPTCHA response.


## Claude in Chrome post-submit closeout (local MCP)

This sequence supersedes outcome-before-close wording for local MCP Claude
runs with confirmed `consent.apply_tab_cleanup = submitted_only`. The user
still performs Submit. A success-confirmed submitted tab is eligible for this
cleanup even while its Trackly member awaits the final submitted outcome.
Never close an unsubmitted review tab, unresolved draft, unrelated tab, or tab
whose exact binding or success state is uncertain. Unknown consent requires a
user decision; declined cleanup preserves tabs and does not prevent truthful
submission reconciliation.

1. Verify the success page for every exact submitted job/run/tab and preserve
   its current-epoch, value-free proof locally. Reclaim or renew the existing
   batch lease if needed while the batch is active; use fresh returned member
   versions and inspection epochs. Never activate Submit.
2. Record each success proof with `trackly_record_apply_submission_evidence`,
   using `evidenceType: confirmation_detected` and `evidenceSource: success_page`.
   Require accepted evidence before closing its confirmation tab. A click,
   intent to submit, or ambiguous page never permits closure.
3. With the same current binding and valid lease, call `tabs_close_mcp` only
   for those success-confirmed submitted tabs. Record each actual close result
   immediately with `trackly_record_apply_surface_evidence` and
   `evidenceType: surface_close_receipt`. Use `ownershipState: controller_owned`
   and `completeInventory: false` when only the MCP group is observable. A
   failed close or rejected receipt remains cleanup pending, never a made-up
   receipt. Do not close again just to repair bookkeeping.
4. Refresh `tabs_context_mcp` after cleanup. Confirm the MCP tab group is empty
   only when it actually is; otherwise list the remaining bound tabs and their
   pending actions. Preserve every unsubmitted sibling, so a nonempty group
   can be the correct result. This inventory covers the MCP tab group only,
   not all Chrome tabs: a dragged-out tab is not proven absent. Keep
   `closure_unverified` unless a complete controller/user union and the normal
   close proof genuinely exist. Never send `surface_post_close_absent` or
   `surface_missing` based only on the MCP group.
5. Only after authorized close attempts and receipt recording, record the final
   `submitted` outcomes through `trackly_record_application_outcomes` (or the
   existing singular outcome tool for an isolated run), with `confirmation:
   success_page` and the exact current batch/member/epoch/lease binding. The
   final outcome can complete the batch and release its lease. Cleanup failure
   does not erase real submission evidence: reconcile confirmed submissions
   and report closure separately rather than withholding or falsifying outcomes.
6. Refetch the exact batch/execution and use `trackly_search_jobs` with
   `status: applied_confirmed`, following pagination for every exact job ID.
   Require member `submitted` and job `applied_confirmed` before claiming
   Trackly closeout.
7. Then follow [post-submission email cleanup](post-submission-email-cleanup.md),
   including its Claude/Superhuman procedure when applicable. Use only the
   authorized account and receipt scope; verify fresh inbox readback. If email
   cleanup is unauthorized, unavailable or incomplete, report its actual
   disposition and continue to the tracker step.
8. In the user's existing authorized outreach-tracker, upsert the matching
   Applications rows idempotently and read them back by exact job/requisition
   identity, preserving existing notes and history.
   Record only the observed application status and supported submission date;
   an application is not an outreach message or follow-up. Do not create a
   parallel tracker or infer access to a private sheet. If the tracker is
   unavailable, leave Applications readback pending and report the precise gap.

Report employer submission, Trackly status, MCP-group cleanup, email cleanup
and Applications row readback independently in the same closeout. Group
emptiness never proves an application was submitted or that every Chrome tab is closed.

Backend verification on 2026-11-02 confirmed that final outcomes can complete
a batch and clear its lease, while the surface-evidence writer accepts current
leased pre-completion evidence. It also has a narrowly fenced completed-batch,
submitted-member evidence path. Completion does not waive close proof or
promise that stale bindings will work; a `409 state_changed` does not by itself
prove lease release was the sole cause. Prefer the sequence above. If outcomes
were already recorded, refetch current state and use only explicitly allowed
operations; never recreate a batch or lease, reapply, invent receipts, or
blindly retry to repair cleanup. Existing submission remains recorded even if
closure stays unverified.
