# Browser handoff compatibility — 4.9.0

This preservation-only policy supersedes contradictory returned-receipt and finalizer requirements in this skill. All backend, submission, resume, origin, ownership, form integrity, and actual visibility gates remain unchanged. Never fabricate evidence.

Accept documented `tab.markHandoff()` when the current runtime explicitly guarantees marked tabs survive the turn, even when its return type is Promise<void>. Before private-data mutation, verify semantic control and stable identity, bind each exact job/run/tab, await its markHandoff call, and verify that same tab remains in the controller inventory and user inventory where exposed. Failed calls or missing tabs block mutation. A harmless test tab proves adapter behavior only.

Before ending every browser turn, refresh inventories and account for every live mapped application tab, including earlier waves and input gates. Await markHandoff on every such tab and recheck their exact inventory presence. Keep the mapping and completed-call/inventory observations locally; never send raw tab IDs or form data to Trackly. On incomplete inventories, report the limitation and never infer closure. If preservation is ambiguous, stop further mutation and report affected tabs without claiming preservation. Do not additionally run a session finalizer on this path.

On later turns, reclaim each exact mapped tab, verify identity and observable form state, and mark it again before mutation or handoff. Missing tabs use the existing run and supported recovery binding. Never assume unsaved form state survived. Marks protect against normal turn cleanup, not browser crashes or employer-side draft loss.

Report completed handoff marks and current inventory checks as observations, not returned persistence receipts. Script-generated status is not an adapter receipt. Do not label mark-only evidence durable_handoff_receipt or alter validators to accept invented receipts. Preservation alone does not prove visibility or review readiness: retain actual presentation evidence requirements and use the visibility-unverified handoff when those cannot be met.

A documented session finalizer with complete inventories and a complete explicit keep set, or a genuine receipt-bearing per-tab durable handoff, remains acceptable. If no supported preservation path exists, stop before mutation. Cloud installation does not confer browser control, authentication, accessibility, uploads, or a supported platform. Check those separately and retain the macOS support boundary.
