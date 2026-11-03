# Claude in Chrome direct file upload

Claude in Chrome's `file_upload` can set a host file directly on an exact
`<input type=file>` found by ref. This is a direct-set-files path, with no
native chooser. Require documented direct-file support and semantic input
discovery; never infer upload capability from a preview or a local path.

Keep the public facade's [approved download transfer](approved-download-transfer.md)
and exact-original approval and byte verification requirements. A browser
primitive alone does not materialize the original or authorize another file.
If secure materialization and immediate hash/size verification are unavailable,
use the documented manual fallback. For local MCP, use the native Apply skill's
prepared-resume verification and local upload validator instead; never mix
hosted and local approval identities or claim a local validator exists hosted.

Prove these four stages in order: `semantic_control_discovered` ->
`set_files_succeeded` -> `user_facing_filename_committed` ->
`parser_fields_rechecked`. Chooser arming/opening are not applicable, never
fabricated passes. A chooser-less adapter without explicit direct-file support
fails closed. Preserve approval, run binding, expiration, same-file attachment,
filename readback, parser-field provenance and final-sweep persistence gates.
Never put a local path into a text field, navigate to a file URL, append another
file over a committed input, or activate Submit.

These stages are observed browser proof, not hosted validator receipts. Keep
that proof locally and report only the existing protocol-supported value-free
observations. If file_upload rejects the verified path, record attachment
failure and use the manual fallback; never substitute another file or claim success.
