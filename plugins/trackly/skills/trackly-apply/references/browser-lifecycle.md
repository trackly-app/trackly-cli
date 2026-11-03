# Claude Code browser lifecycle

Use `browserSurface: claude_in_chrome` when allowed by the protocol. Follow
[handoff compatibility](handoff-compatibility.md) for persistent real Chrome
tabs: fresh `tabs_context_mcp` inventory before mutation and at turn end, exact
tab reclaim and identity checks on the next turn, and existing-run recovery
when a tab is missing. The inventory covers only the MCP group; a tab dragged
out of it is not proven absent. Keep `closure_unverified` unless the normal
complete controller/user union and close proof are available.

Bind through `trackly_report_apply_progress` with `operation: bind_surface`
and a published `<provider>:<major>` adapter code such as `ashby:1`, never
bare `ashby` or a browser name. Use only the protocol-supported adapter set.
The browser surface and ATS adapter are separate identities. Keep the same
frozen member and run; obey returned version and inspection epoch.

For user-named jobs, save each exact approved job with `trackly_update_status`
and `action: saved` and verify Check Later membership before starting with the
exact ordered selection. A rejected selection never permits queue substitution.

For `observationType: scenario_coverage`, use only `resolutionCode: passed` or
`resolutionCode: corrected`. Another code rejects the entire bulk call; other
observation types retain their own codes.
