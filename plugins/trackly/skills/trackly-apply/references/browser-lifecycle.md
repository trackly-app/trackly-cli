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

For explicitly selected or user-named jobs in a new selection, save each exact
not-yet-saved approved job with `trackly_update_status`
and `action: saved` and verify Check Later membership before starting with the
exact ordered selection. Do not change tracker status during existing-execution recovery or overwrite
submitted or dismissed status without explicit user instruction. A failed save
or unconfirmed membership blocks starting. A rejected selection never permits
queue substitution.

For `observationType: scenario_coverage`, use only `resolutionCode: passed` or
`resolutionCode: corrected`. Another code rejects the entire bulk call; other
observation types retain their own codes.

The versioned [public Apply contract](https://github.com/trackly-app/trackly-cli/blob/main/contracts/trackly-apply-tools.json)
lists published codes under `constants.applyAdapterCodes`. The backend remains
the authority for current acceptance. If the exact provider/code cannot be
established, preserve the tab and stop binding; never invent an adapter or
substitute `generic_web_form:1` for a known ATS. An inventory failure or an
unverifiable mapped tab mid-turn or at turn end stops mutation; follow
existing-run recovery without claiming preservation.

After manual submission, follow [Claude post-submit closeout](review-handoff.md#claude-in-chrome-post-submit-closeout).
Close only success-confirmed submitted tabs under the confirmed
`consent.apply_tab_cleanup = submitted_only` preference, use `tabs_close_mcp`,
and refresh `tabs_context_mcp`. Empty inventory means only the MCP group is
empty; preserve unsubmitted siblings. Read back exact `applied_confirmed` jobs
then follow [post-submission email cleanup](post-submission-email-cleanup.md),
then the existing outreach-tracker Applications rows in the same closeout.
The native local MCP receipt-before-final-outcome sequence and hosted atomic
reconciliation are separate paths; never mix their tools or private lease state.
