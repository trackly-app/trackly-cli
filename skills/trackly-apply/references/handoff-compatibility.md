# Browser handoff compatibility — 4.9.5

This preservation-only policy supersedes contradictory returned-receipt and finalizer requirements in this skill. All backend, submission, resume, origin, ownership, form integrity, and actual visibility gates remain unchanged. Never fabricate evidence.

Accept documented `tab.markHandoff()` when the current runtime explicitly guarantees marked tabs survive the turn, even when its return type is Promise<void>. Before private-data mutation, verify semantic control and stable identity, bind each exact job/run/tab, await its markHandoff call, and verify that same tab remains in the controller inventory and user inventory where exposed. Failed calls or missing tabs block mutation. A harmless test tab proves adapter behavior only.

Before ending every browser turn, refresh inventories and account for every live mapped application tab, including earlier waves and input gates. Await markHandoff on every such tab and recheck their exact inventory presence. Keep the mapping and completed-call/inventory observations locally; never send raw tab IDs or form data to Trackly. On incomplete inventories, report the limitation and never infer closure. If preservation is ambiguous, stop further mutation and report affected tabs without claiming preservation. Do not additionally run a session finalizer on this path.

On later turns, reclaim each exact mapped tab, verify identity and observable form state, and mark it again before mutation or handoff. Missing tabs use the existing run and supported recovery binding. Never assume unsaved form state survived. Marks protect against normal turn cleanup, not browser crashes or employer-side draft loss.

Report completed handoff marks and current inventory checks as observations, not returned persistence receipts. Script-generated status is not an adapter receipt. Do not label mark-only evidence durable_handoff_receipt or alter validators to accept invented receipts. Preservation alone does not prove visibility or review readiness: retain actual presentation evidence requirements and use the visibility-unverified handoff when those cannot be met.

A documented session finalizer with complete inventories and a complete explicit keep set, or a genuine receipt-bearing per-tab durable handoff, remains acceptable. If no supported preservation path exists, stop before mutation. Cloud installation does not confer browser control, authentication, accessibility, uploads, or a supported platform. Check those separately and retain the macOS support boundary.

## Claude Code with Claude in Chrome

On macOS, `claude_in_chrome` is a supported browser surface when the fetched
protocol allows it. Claude in Chrome's MCP tab group contains real tabs in the
user's own Chrome and remain open across normal turns without `markHandoff`
or a session finalizer. This is observed runtime behavior, not an unconditional
persistence guarantee across browser crashes, restarts, or group removal.
This is a third supported preservation path, not a fabricated handoff receipt. Verify browser control, stable tab identity, and the exact
job/run/tab binding before mutation, then call `tabs_context_mcp` and require
each mapped tab to be present in the MCP group. Failed calls or missing tabs
block mutation; never treat a no-op as proof of persistence.

At every turn end, refresh `tabs_context_mcp` and verify every live mapped
application tab, including earlier waves and tabs waiting for user input.
Keep their binding ledger locally. Do not close the group or its tabs as turn
cleanup, and do not invoke a Codex finalizer on this path. On the next turn,
refresh the inventory, reclaim the exact tab, and revalidate employer, role,
requisition, origin, tenant policy, current run authority, and observable form
state before continuing. Missing tabs follow existing-run recovery; never
assume unsaved draft state survived. If inventory fails or any mapped tab
cannot be verified mid-turn or at turn end, stop further mutation, report the
affected bindings without claiming preservation, and use existing-run recovery.
An MCP-group inventory is incomplete for all Chrome tabs, but must account for
every bound application tab before preservation can be claimed.

`tabs_context_mcp` inventories only the MCP group, not all user Chrome tabs.
A tab dragged out of that group is not proven absent. Report incomplete
inventory honestly; closure remains `closure_unverified` unless a complete
controller/user union, explicit close receipt, and post-close absence prove
otherwise. Group presence proves reachability for preservation, not current
visibility, attachment integrity, truth certification, or review readiness.
Retain every other gate and never activate Submit.
