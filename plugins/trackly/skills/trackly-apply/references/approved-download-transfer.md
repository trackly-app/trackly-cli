# Approved resume download and attachment

Show the original resume, obtain exact-file approval, download through the private preview, verify its bytes, then attach it to the approved employer form. The agent performs file handling. The user reviews and submits.

Require documented host support for a completed download with a verifiable local artifact/path, SHA-256 and size verification, and a semantic file chooser. The compatibility flag requiresLocalAgentOrManualUpload does not prove that the browser lacks these capabilities.

Keep the same authenticated account, execution, profile revision and exact resume approval. Never substitute a locally signed-in account. Open the preview through its rendered UI; never extract the component-only capability or put it in chat, commands or employer fields.

Arm the documented download observer, then activate Download resume. Use the artifact from the completed download receipt. If the host saves to its configured Downloads directory without returning a path, compare that directory before and after the observed download and accept only the newly created file whose bytes match the approved identity. Never choose an older same-named file, guess paths or invent download methods. A click or preview URL is not proof of file transfer.

Immediately before attachment verify the original filename, SHA-256 and size. On hosts with Node.js and local file access, use scripts/verify-downloaded-resume.js with --path, --filename, --sha256 and --size, using safe argument passing. Use its verified private copy, which preserves the original filename. Keep local paths out of Trackly progress reports. Other hosts require an equivalent documented verifier.

Revalidate the employer origin, tenant and job. Arm the file chooser, select the verified copy once, verify its committed filename, and recheck fields affected by resume parsing. Preserve user edits. Only then record the resume_attachment observation from lifecycle-contract.md with the current binding and approved identity.

Stop on changed bytes, expired approval, changed profile/execution, missing artifacts or ambiguous upload. Report the specific missing capability rather than assuming manual upload is required. Never claim verified attachment from a filename alone. Final Submit stays with the user.
