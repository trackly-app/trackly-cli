# Browser upload

Resume approval proves the content the user authorized. Attachment proof proves
that the browser committed that exact file. Neither fact substitutes for the
other.

## Capability gate

Before an automated upload, require semantic control discovery, file attachment,
committed-filename inspection, and parser-field recheck, plus either chooser
arming or explicit `directFileSet: true` support. For Claude in Chrome,
`file_upload` sets the verified host file directly on the exact
`<input type=file>` found by ref; no native chooser is involved. Set
`chooserArming: false` and `directFileSet: true` only when that primitive is
available and the exact input is unambiguous. A chooser-less adapter without
explicit direct-file support fails closed.

If neither chooser arming nor direct file setting, or file attachment, is
available, fail closed before upload and hand attachment to the user only when
all three verification capabilities remain available. If any verification
capability is unavailable, stop the fill as unverified; do not route it into
`manual_unbound`, claim a passed audit, or continue to review. Never navigate to
a `file://` URL or paste a local path into an ordinary text field.

When the user performs that handoff upload, keep it explicitly manual,
browser-local, and unbound. Record `resumeAudit.mode: manual_unbound`,
`approval: passed`, `preAttachVerification: not_applicable`, and
`attachmentCommit: user_confirmed` only for this genuine manual path; do not use
those values for an agent-performed upload or a failed verifier. Before
continuing, require `passed` filename verification and parser recheck, then
prove during the `passed` final sweep that the attachment and filename persist.

For the chooser path, perform these stages in exact order:

1. identify the exact semantic Resume or CV control;
2. arm the file chooser before clicking that control;
3. prove the chooser opened;
4. run `trackly_verify_prepared_resume`, then immediately attach that verified
   file through the adapter's documented file-setting primitive;
5. verify the employer-facing filename committed;
6. recheck every contact, employment, education, and other field that resume
   parsing may have changed; and
7. during the final sweep, prove the attachment is still committed and the
   visible filename remains the approved employer-facing filename.

For the direct-set path, omit chooser stages entirely (not fabricated passes):
`semantic_control_discovered` -> `set_files_succeeded` ->
`user_facing_filename_committed` -> `parser_fields_rechecked`. Immediately before
`file_upload`, run `trackly_verify_prepared_resume` and attach only its verified
exact prepared host path with the approved filename. Keep exact-file approval,
hash, size, run binding, expiry, parser provenance, and final-sweep persistence
checks identical to the chooser path. Do not switch paths to hide a failed
chooser or accept an arbitrary file.

Pass only the value-free stage outcomes to
`trackly_validate_apply_resume_upload`. Do not pass a filename, local path,
resume hash, form value, URL, page text, or tab identifier. Claim attachment
success only when it returns `safeToClaimAttachment: true`. Record the six
audited outcomes separately: approval, pre-attach verification, attachment
commit, filename verification, parser recheck, and final-sweep persistence. A
single upload-success boolean cannot replace this chain.

Stable failure codes include capability unavailable, ambiguous control,
chooser timeout, chooser opened without a commit, missing or expired file,
file-setting failure, uncommitted filename, unexpected file navigation,
unsettled parser, and parser-field regression. A failure is a handoff or retry
decision, never permission to guess another control or weaken verification.

Snapshot field provenance immediately before upload. Mark parser changes as
`parser_filled`; preserve a later user edit byte-for-byte. After ledger loss,
preserve every unknown non-empty value. Never let parser rechecks or the final
required-field sweep overwrite user-owned or unknown external values.

The employer-facing filename must remain the user's confirmed filename.
Random cache identifiers may appear only in private parent directories.
