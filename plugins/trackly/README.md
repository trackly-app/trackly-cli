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
