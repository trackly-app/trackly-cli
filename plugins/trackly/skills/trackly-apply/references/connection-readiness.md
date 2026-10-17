# Connection readiness and account recovery

The plugin supplies its MCP endpoint and workflow. The host owns connector
discovery, browser launch, OAuth callback handling, and credential persistence.
Trackly owns its authorization service and account-scoped application data.
Diagnose the failing stage before changing either side.

An established connector's successful authenticated read-only call is enough
connection evidence. Do not demand a historical login receipt or reconnect a
working connector. The completion and persistence checks below apply to a newly
initiated or still-pending sign-in.

## Tools are missing

Inspect the installed plugin's enabled/connected state through the host's
documented plugin controls. Use its existing Connect or Sign in action and the
packaged MCP endpoint; do not add another connector, switch to a local CLI
account, or modify authentication configuration merely because the skill loaded
without tools. A native Trackly app is not required for hosted MCP access.

Use the user's identified Trackly account. Never select a Google or Trackly
identity just because its name matches, it is the default or preselected choice,
or it was used recently. If the intended account is unknown, let the user choose
it in the account selector or ask for that one account choice. The user completes
credentials, verification, and consent in the supported sign-in UI.

Success requires the host to finish authorization, expose fresh tool discovery,
and complete a read-only Trackly call. An Allow click, redirect, installed skill,
or browser account selection proves only that step. Do not announce a successful
connection while the host's login process is still pending or reports an error.

## Sign-in stalls or authorization cannot be saved

Use visible state and redacted host diagnostics to distinguish a Trackly error
from an interrupted browser navigation. If an embedded browser cancels the
identity-provider redirect, start a fresh authorization flow through the host's
documented external-browser path and use its newly generated authorization URL.
Do not copy an intermediate `/mcp-consent?pending_id=...` page into another
browser: its pending record is bound to browser cookies and may already be
consumed. Restart only the failed connection through the host. Never manufacture
a callback or transfer authorization codes, cookies, or tokens between browsers
or accounts.

If the callback succeeded but the host reports a credential-store or OAuth-lock
permission error, report that exact host-side stage. Use the host's permission
flow for only the path or keychain access its diagnostic identifies, then retry
once and verify completion and tool discovery. Do not read or edit credential
files, weaken permissions, grant broad home-directory access, or change Trackly
production settings. If the supported retry fails, preserve the useful redacted
error and stop repeated login attempts. Give the user the one remaining action
or identify the host issue; do not claim that a Trackly skill update repairs it.

Across all connection stages, apply a supported remediation and retry once. If
the same failure recurs, stop that retry loop and report the failed stage and
next action. A user-corrected account choice is new information, not a reason to
keep repeating a failed browser, callback, persistence, or discovery step.

## Connected data does not match the expected account

Use the non-secret authenticated identity returned by a supported host/tool, when
available, and compare it with the intended account. An installed-plugin label,
Google display name, or profile revision does not verify identity. Inspect an
already available Trackly account label before asking the user to open another
surface. When the facade does not expose identity, report that limitation and
ask one targeted account question instead of inventing an identity endpoint.

Treat an unexpected empty queue, older profile revision, different preferences,
or disabled Apply capability as evidence to investigate, not permission to
rebuild the profile, add jobs, or change accounts. State that the connected
account returned those values. Resolve an account mismatch with the host's
supported connection flow. After a successful account switch, refresh or reload
the MCP connection through the host's documented controls and refetch readiness;
a running client may still hold the previous grant. If this chat cannot reload
its connector, explain the supported restart or new-chat action instead of
switching identities again. Never carry work across OAuth grants; follow the
skill's active-execution mismatch instructions.

Readiness availability, queue membership, profile completeness, and Apply
capability are separate checks. A disabled execution flag may reflect account
rollout or backend readiness; it does not establish a missing skill or a global
outage. An unavailable queue card is not an empty queue. After identity is
resolved, report authoritative blockers and continue the authorized work.
