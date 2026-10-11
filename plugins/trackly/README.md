# trackly

The trackly plugin package for ChatGPT and Codex.

**Hero feature:** trackly Apply

trackly finds openings as they appear using your preferences and job metadata. You decide what to pursue. trackly Apply fills approved applications for your review. You submit manually.

## What is included

- Real-time job and company search through the authenticated trackly MCP facade.
- A public, safety-preserving `trackly-apply` skill for filling user-approved applications.
- A resumable lifecycle contract: minimal missing-profile labels, batch-bound work, atomic review certification, and evidence-bound manual-submission reconciliation.
- Facade-owned private batch leases that are never exposed to the model.
- Manual resume uploads remain browser-local, unbound, and unattested.
- A derived vector of the approved white trackly arrow mark on black. It is not claimed to be byte- or pixel-identical to the source PNG; Kevin approved the exact packaged SVG bytes whose SHA-256 is recorded in `assets/brand-source.json` for the OpenAI listing.
- Submission fixtures covering expected and out-of-scope behavior.

An account is required. trackly is free for all users, with initial availability in the United States. Matching reflects your stated preferences and job metadata; it is not an employer hiring decision or candidate ranking.

## Safety boundary

The plugin may fill an approved application and prepare it for review. It never activates the final Submit control. Only the user submits an application.

## Connection

`.mcp.json` connects to the dedicated public plugin facade:

`https://mcp.usetrackly.app/api/plugin/trackly/mcp`

The MCP client discovers the OAuth resource through protected-resource
metadata. Do not repeat that URL as `oauth_resource`. Affected Codex versions
send the same RFC 8707 `resource` parameter twice, and Express then parses it
as an array the authorization server rejects.

The legacy trackly MCP endpoint is intentionally not used by this package.

After installing, use your host's plugin connection controls to sign in to the
Trackly account that holds your saved jobs. If you have several Google accounts,
choose that account explicitly. A matching name or preselected account does not
establish that it contains your Trackly profile. The hosted plugin does not
require the native Trackly app or a separate CLI login.

Connection is complete when the host reports success, discovers Trackly's tools,
and a read-only call works. Clicking Allow is only part of the flow: the host must
receive the callback and save authorization. If embedded sign-in stops at
Connecting, use the host's supported external-browser sign-in path. If the host
reports an OAuth-lock, keychain, or credential-storage error, resolve that
specific host permission and retry the connection; do not copy tokens or edit
credential files. Repeated failure needs the redacted error and failing stage,
not another connector or a different Trackly account.

If connection works but saved jobs or profile details are unexpectedly missing,
verify the connected account before entering the same information again.
After an account switch succeeds, refresh the host's MCP connection so subsequent
calls use the new authorization; a running client may still hold the old grant.
Apply availability is also account- and backend-dependent; installing more skills
does not enable a disabled capability. Trackly's service handles account data
and authorization, while Codex or ChatGPT handles its browser flow, credential
storage, and tool discovery. Report the failing stage so the appropriate side
can be fixed.

The plugin never bypasses employer access controls, CAPTCHA, OTP, credentials, or
account-creation requirements. It stops at a review-ready form and the user
activates Submit manually.

## OpenAI submission

The OpenAI listing is created as a new **With MCP** draft in the
[OpenAI Platform plugin portal](https://platform.openai.com/plugins). The portal
scans the production MCP facade directly; this package does not invent or bind a
ChatGPT developer-mode app ID, so `.app.json` remains intentionally absent.
`.mcp.json` continues to describe the remote MCP connection used by the packaged
Codex plugin. See [RELEASE-GATES.md](RELEASE-GATES.md).
