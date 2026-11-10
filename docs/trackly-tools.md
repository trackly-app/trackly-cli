## Trackly Job Tracker (MCP)

Trackly MCP server provides job search and tracking tools. Two ways to connect:

### Claude co-work, Claude Desktop, ChatGPT (hosted, no install)

In your AI tool, open **Settings → Connectors → Add custom connector**:

- URL: `https://mcp.usetrackly.app/api/mcp`
- Leave any optional OAuth fields empty — **Client ID**, **Client Secret**, **Authorization URL**, **Token URL** — Trackly uses OAuth 2.1 Dynamic Client Registration and will register the client automatically
- If the client UI uses different labels or requires you to continue past an OAuth section, keep those fields blank and proceed to sign in. Do not invent client credentials or endpoint URLs.

Sign in with Google when prompted. [Visual guide →](https://usetrackly.app/connector)

### Cursor, Windsurf, Claude Code (CLI via stdio)

Install and start the stdio server:

```bash
npm install -g trackly-cli
trackly mcp
```

#### Claude Code

```json
{
  "mcpServers": {
    "trackly": {
      "command": "trackly",
      "args": ["mcp"]
    }
  }
}
```

#### Cursor / Windsurf

Add to `.cursor/mcp.json` (same schema for Windsurf):

```json
{
  "mcpServers": {
    "trackly": {
      "command": "trackly",
      "args": ["mcp"]
    }
  }
}
```

### Authentication

Use either interactive OAuth:

```bash
trackly login
```

Or an API key:

```bash
trackly config --api-key trk_xxxxxxxxxxxxxxxxxxxx
```

You can also pass `TRACKLY_API_KEY` as an environment variable for one-off runs.

Existing memberships work across the CLI and local MCP server. New memberships
are invite-only during the limited rollout; access errors link to
https://usetrackly.app/early-access instead of recommending repeated OAuth or
API-key creation attempts.

### Available Tools

- **get_more_tools** — Report what the agent wanted to do when no Trackly tool fit, so Trackly can improve its MCP surface. The tool is always available; report delivery is best-effort.
- **trackly_search_jobs** — Search/filter jobs. A successful page may have `total: null`, `pagination.total: null` and `countStatus: "unavailable"` when its total cannot be computed. The returned jobs remain valid: explain `countGuidance`, use `hasMore` and pagination to continue, and avoid retrying just to obtain a total. Zero is a known count; null is unknown. A numeric `total` with `totalIsLowerBound: true` (also in `pagination`) means at least that many matches, not an exact count. `false` marks a known exact total; `null` leaves the total unknown. Natural-language `trackly_ask` preserves these page fields: `total`, `totalIsLowerBound`, `countStatus`, `countGuidance`, `hasMore`, `pagination`, and `recencyStats`. It keeps the ask interpretation and validated continuation URL authoritative; unrelated jobs-page fields are omitted. It returns one page and takes no pagination input: continue there with `trackly_search_jobs` and `offset`. Genuine page failures remain tool errors.
  - `function` (one value) or `jobFunctions` (nonempty array, OR; use one spelling only). The 14 values are: `product`, `engineering`, `design`, `data`, `marketing`, `sales`, `partnerships`, `finance`, `strategy`, `operations`, `people`, `legal`, `support`, `other`
  - `region`: nonempty array of `us`, `europe`, `latam`, `middle_east`, `asia`, `africa`, `canada`, `oceania`, `remote`, `unknown`, combined with OR. Use instead of `locationFilter`; unlike its legacy list form, this supports US plus other regions.
  - `usStates`: nonempty array of US codes `AL`, `AK`, `AZ`, `AR`, `CA`, `CO`, `CT`, `DC`, `DE`, `FL`, `GA`, `HI`, `ID`, `IL`, `IN`, `IA`, `KS`, `KY`, `LA`, `ME`, `MD`, `MA`, `MI`, `MN`, `MS`, `MO`, `MT`, `NE`, `NV`, `NH`, `NJ`, `NM`, `NY`, `NC`, `ND`, `OH`, `OK`, `OR`, `PA`, `RI`, `SC`, `SD`, `TN`, `TX`, `UT`, `VT`, `VA`, `WA`, `WV`, `WI`, `WY`, `PR`, `REMOTE`.
  - `caProvinces`: nonempty array of `AB`, `BC`, `MB`, `NB`, `NL`, `NS`, `NT`, `NU`, `ON`, `PE`, `QC`, `SK`, `YT`, `REMOTE`. Geographic children follow the backend location rollout: parent-scoped OR applies under canonical enforcement; legacy compatibility remains before that. `REMOTE` alongside codes also includes remote jobs.
  - `internshipLevels`: nonempty array of `undergraduate`, `graduate`, `mba`, `not_specified`, combined with OR. Applies to internships when `jobModality=internship` or `all`; full-time jobs remain unaffected. Set `jobModality` explicitly when you want internships; education levels do not change your saved/default modality.
  - `favoriteCompaniesOnly` (boolean): restrict to your favorited companies; `false` explicitly disables it.
  - `postedWithinDays`: `0`, `1`, `3`, `7`, `14`, `30`; `0` disables the saved posting window. Uses the backend discovery-date policy; omitted uses saved/default preferences only with status omitted, `new`, or `all`. Explicit pipeline views (`applied_confirmed`, `check_later`, `not_interested`) skip the saved window/floor; explicit request values still apply.
  - `salaryFloorUsd`: integer `0`–`1000000`. Excludes comparable listed annual-USD minimums below this floor. Unknown, hourly and non-USD salaries remain visible; this is not a guaranteed salary threshold. `0` disables the floor; omitted uses saved/default preferences only with status omitted, `new`, or `all`. Explicit pipeline views (`applied_confirmed`, `check_later`, `not_interested`) skip the saved window/floor; explicit request values still apply.
  - `since`: ISO-8601 date or timestamp within the past 90 days, never in the future. Filters when Trackly first saw a job, rather than the employer posting date. Prefer a timestamp with timezone for incremental sync. Since does not reset filters. Saved posting and salary constraints apply only with status omitted, `new`, or `all`; explicit pipeline views skip those saved constraints while retaining explicit request filters: use `postedWithinDays:0` and `salaryFloorUsd:0` to disable those saved constraints.
  - `locationFilter`: compatibility alias; use instead of `region`. Pass ONE of
    - a single scalar: `us`, `non_us`, `all`, or a region tag (`europe`, `latam`, `middle_east`, `asia`, `africa`, `canada`, `oceania`, `remote`, `unknown`), OR
    - an array of region tags for multi-region (e.g. `["europe", "canada"]`). The array form excludes `us` — combining `us` with other tags in an array causes the backend to silently drop the others. To get "not US" use the scalar `non_us` alone.
  - `jobModality`: `full_time`, `internship`, `all` — employment type, NOT work arrangement.
  - `workArrangements`: one or more of `remote`, `hybrid`, `in_person`, `unspecified`. This is an independent axis and combines with region, employment type, and function filters.
  - `roleTypes`: one or both of `corporate`, `frontline`. `corporate` (the default) hides store, warehouse, food service, driving, security, skilled trades and care-aide jobs; `frontline` shows only those; both show every role. Omitted uses the student's saved preference. Applies to status `new` and `all`; pipeline views (`applied_confirmed`, `check_later`, `not_interested`) are never filtered by role type.
  - `remote` (boolean): filter to remote jobs only. Maps to `usStates=REMOTE`. Do not combine `remote=true` with geographic child arrays; use their `REMOTE` token for alternatives. Do not combine a parent region with `remote=true` or only `REMOTE` children: that backend form overrides the parent. Use `workArrangements:["remote"]` plus your region for remote work within that geography.
  - `status`: your application pipeline state. Values: `new`, `applied_confirmed`, `check_later`, `not_interested`, `all`.
  - `sort`: `newest` (default) or `match` (highest match score first; requires a resume on file). Backend rejects the deprecated values `oldest` and `company` with HTTP 400.
  - `sponsorship`: `all` (no restriction), `exclude_no` (keep yes **and unknown/not mentioned**, exclude reliable explicit no), `only_yes` (reliable explicit yes only). “Not no” means `exclude_no`, never `only_yes`; ask when intent is ambiguous. Filtering requires `status=new`, which is defaulted when omitted; other pipeline views ignore this filter.
  - `keywords`: legacy keyword search, maximum 500 characters. Title/company/location matching is supported; description recall depends on the backend provider. This is not guaranteed full-catalog literal, phrase or exclusion search.
  - `companyId`: positive integer from company search.
  - `limit`: integer `1`–`100`, MCP default `20`; `offset`: non-negative safe integer, default `0`. Keep all filters and sort unchanged while paging. The live catalog may change between calls.
  - Unsupported keys are rejected before HTTP, including when usage analytics is enabled. Industry, specialization and literal-search controls are not exposed until their backend contract is deployed.

Example: `{"jobFunctions":["finance","partnerships"],"region":["us","europe"],"sponsorship":"exclude_no","postedWithinDays":7,"limit":20}`.
The local package and hosted service have separate release lifecycles. Refresh the client's tool discovery after upgrading or reconnecting and use only parameters its current schema advertises.

- **trackly_get_job** — Get full job details by positive numeric Trackly ID from search or the saved queue. Employer requisition IDs and URLs are not accepted.

Job results use `matchScoreStatus: "scored" | "pending" | "not_scored"`. A score is a saved result; never estimate a numeric score when it is null. `pending` means the backend reports work still outstanding for this job; it is the only status that means a score may still arrive. `matchScoreReason` explains a missing score:

| Reason | Meaning |
| --- | --- |
| `null` | A saved score is present. |
| `outside_scoring_window` | The job was first seen outside the automatic 30-day scoring window, so it is not scored automatically. |
| `parse_required` | The job description still needs to be parsed before it can be scored. |
| `score_required` | The description is parsed, but no score is saved yet. |
| `description_unavailable` | No usable job description is available to score. |
| `inactive` | The job is inactive, so no score is shown. |
| `not_scored` | No score, and the reason cannot be determined. |

`parse_required` and `score_required` name a missing prerequisite, not a queued task. A reason never promises a running job, a ready resume, available retries, or a completion time: only `matchScoreStatus=pending` means a score may still arrive, and it carries no deadline either. So report the job as not yet scored, and do not poll for a score or estimate one. A valid saved score always wins over a reason, and when the status cannot be determined it stays `not_scored`.

The backend owns when a score is produced. These values are the stable part of the API; the queue, cooldown, lease and revision mechanics behind them are backend implementation, are not public API, and are deliberately not documented here. Read the fields, not the machinery.

- **trackly_search_companies** — Semantic company search
- **trackly_list_companies** — List all tracked companies with job counts
- **trackly_get_stats** — Job tracker metrics dashboard
- **trackly_get_preferences** — Read a bounded preference response containing only `success`, `experienceFilterV2Available`, and the authenticated user's discovery `preferences`, including selected roles, saved role-specific limits, and the revision required for a safe update. Availability authorizes editing; it does not report feed or alert enforcement.
- **trackly_update_experience_limits** — Atomically replace the complete role-specific experience-limit map.
  - `experienceLimitsByJobFunction`: object whose keys are the 14 canonical job-function values and whose values are integer years from `0` through `60`. An empty object turns this filter off.
  - `expectedPreferenceRevision`: non-negative safe integer from the latest `trackly_get_preferences` result. A stale revision is rejected; refetch and reconcile with the user rather than retrying blindly.
  - The tool checks `experienceFilterV2Available` immediately before writing and refuses without a PUT unless it is exactly `true`.
  - When server-side enforcement is active, a job remains visible when its stated minimum is less than or equal to that role's limit. Jobs with no stated minimum remain visible.
- **trackly_update_status** — Mark a job as applied, saved, or dismissed
- **trackly_list_tracker_applications** — List your Tracker board entries (`/tracker`: `saved`, `contacted`, `applied`, `screen`, `assessment`, `interview`, `final`, `offer`, `accepted`, `declined`, `rejected`, `withdrawn`). Optional `stage`, `query` (company or role text, at most 100 characters) and `jobId` filters. Each entry returns `id`, `jobPostingId`, `company`, `role`, `currentStage`, `stageEnteredAt`, `version` and `link`. Pass `applicationId` alone to get that entry with its events (ids, kinds, stages, dates and note text), for example to name an event to undo. Contact email addresses are never returned.
- **trackly_create_tracker_application** — Add a job to the Tracker board (Quick Add). Creating an entry records the job as applied, so call it only after the user confirms they applied and pass `explicitUserConfirmed: true`. Pass `jobId`, or `companyName` and `roleTitle` (at most 200 characters each); optional `appliedOn` (`YYYY-MM-DD`, a local date in America/Los_Angeles) and `link` (http(s)). When the job, or the same company and role, is already on the board, nothing is written and the existing entry returns with `created: false` and `reason: "already_tracked"`. A repeated call never adds a second entry.
- **trackly_update_tracker_stage** — Move one Tracker entry (`applicationId` or `jobId`, exactly one) to a stage, as a drag on the board does, with an optional `occurredOn` date and a dated `note` of at most 1,000 characters. This is separate from `trackly_update_status`: marking an entry rejected keeps its Applied record. There is no paused stage; record a pause with `trackly_add_tracker_note`. Returns `changed`, `stageEventId`, `noteEventId` and `noteSaved`; `reason` explains a no-op (`already_in_stage`, `already_recorded`, `later_stage_event`, `replayed_retracted_event`). The tool never creates an entry: a job without one returns `not_found`.
- **trackly_add_tracker_note** — Add a dated note (`text`, at most 1,000 characters, optional `occurredOn`) to one Tracker entry without changing its stage. The same text on the same day is never added twice.
- **trackly_retract_tracker_event** — Undo one Tracker event the user names, by `eventId`, as the board's undo does. Retracting an already retracted event changes nothing; an entry's only stage event and a retraction itself cannot be retracted.

The five Tracker tools call the same backend routes as the `/tracker` board with your own credentials. Every write reads the entry first, sends its version, retries once on a version conflict, and uses a deterministic idempotency key, so a repeated call replays instead of writing twice. Errors write nothing:
  - `not_found`, `tracker_unavailable` (the Tracker is switched off), `ambiguous_job` (two entries hold the job; pass `applicationId`);
  - `version_conflict` and `merged`, which carry `version`, `currentStage`, `mergedIntoId` and the entry;
  - `idempotency_key_reused`, `invalid_request`, `duplicate_check_incomplete`, `cannot_retract_only_stage`, `cannot_retract_retraction`;
  - `replayed_retracted_note` from `trackly_add_tracker_note`, when the same note was added and undone the same day;
  - `invalid_tracker_response` (local MCP only), when a 2xx response is not a readable Tracker entry or list, for example a proxy page.

  A stage change whose follow-up note was not saved is still a success, with `noteSaved: false` and `noteError` set to `note_edited_since`, `replayed_retracted_note`, or the backend's error code (`note_write_failed` when it has none). `trackly_add_tracker_note` returns `noteSaved: false` with `reason: "note_edited_since"` when the same note was edited on the board since; nothing is written. The hosted connector registers the same five tools. Three local-only adaptations: an unreadable 2xx list is an error rather than an empty board, so create never skips its duplicate check; a note write that meets a version conflict re-reads the entry first and reuses a same-day copy a concurrent call added; and an undated stage change is judged as observed after the latest event read, so a local clock that lags the backend does not hide a move after a recent board change. A same-stage event dated today can still outrank it when the skew spans Los Angeles midnight.
- **trackly_auto_apply** — Request cloud auto-apply for one US Greenhouse, Lever, or Ashby job using the account default resume. Arguments: `{jobId: number}` (positive integer, at most 2147483647). Call only when the user asks Trackly to apply and notify them. Returns the request and status. The server decides availability and limits; 404 `feature_disabled` means unavailable for this account, while `job_not_found` asks for a valid job ID; 429 carries plan usage/reset details and an optional server-provided upgrade URL. Available in local source; pending the coordinated hosted release. Check progress with `trackly apply --status` in the CLI.
- **trackly_ask** — Natural language job search. Takes only a query and returns one page with the same count metadata as `trackly_search_jobs`, plus the parsed filters it inferred. It has no pagination input, so when `hasMore` is true continue with `trackly_search_jobs` using supported structured filters and `offset`; repeating the query returns the same first page. An unreadable follow-on job page is a tool error, not an empty result.
- **trackly_get_job_brief** — Get network brief for a positive numeric Trackly job ID (company signal, top contact, actions).

Both job tools return JSON text and matching `structuredContent`. A recognized missing or removed posting, or an explicitly inactive posting, returns `availability: "unavailable"`, a reason, `retryable: false`, and a `nextStep` directing the agent to search for current openings. This is a normal tool result. Closed briefs retain their allowed stored company and role context, but omit stale recommended motions and application actions. A missing availability flag means unknown, not closed; detecting closed briefs requires a backend that supplies that flag.

Actual failures retain `isError: true`, HTTP status when available, a closed `category`, `retryable`, `maxRetries`, and a next step. Categories are `authentication`, `authorization`, `validation`, `not_found`, `conflict`, `rate_limit`, `timeout`, `server`, `network`, `maintenance`, `access`, or `unknown`. Transient read failures permit one retry after `retryAfterSeconds`, honoring the longer valid API body or HTTP `Retry-After` delay (seconds or HTTP date); the tools add no automatic retry loop. The `nextStep.message` always explains what to do; `nextStep.tool` is present when a corresponding MCP tool exists. Authentication and invalid-input failures require a corrected request first. A route or unrelated dependency 404 remains an error. Invalid argument shapes are rejected by MCP schema validation before any API call; correct the arguments before retrying.
- **trackly_contacts_at_company** — Search contacts at a specific company
- **trackly_get_company_workspace** — Get full company workspace (jobs, contacts, hiring managers, campaigns)
- **trackly_request_company** — Request that a company be added to Trackly's tracked companies. Rate-limited to 5 pending requests per user. Parameters: `companyName` (required), `companyUrl` (optional), `notes` (optional).
- **trackly_get_apply_queue** — Get user-approved check-later jobs in deterministic execution order.
- **trackly_get_application_profile** — Get the versioned, scoped application profile.
- **trackly_get_profile_onboarding** — Get backend-owned questions plus only missing/unconfirmed answers.
- **trackly_update_application_profile** — Save explicit answer states with optimistic concurrency and global/provider/company scope. Setting `sensitiveStorageConsent=false` is destructive and requires a second call echoing the `sensitiveRevocationConfirmToken` from the returned challenge.
- **trackly_start_apply_execution** — Start a server-owned `complete_next_n_accessible` execution with a target from 1–20. For explicitly selected jobs, pass their exact ordered `jobIds` and set `target` to the list length; no unrelated replacements are allowed. Omit `jobIds` only for a requested recent-first queue target. Consume authoritative `progress` and `nextAction` before browser work; never retry a rejected exact selection as count-only.
- **trackly_get_active_apply_execution** — Recover the active execution before legacy batch recovery.
- **trackly_get_apply_execution** — Read an execution's latest current-wave identity and authoritative aggregate progress funnel.
- **trackly_list_recoverable_apply_executions** — List a bounded, value-free menu of exact recovery candidates after local context loss.
- **trackly_recover_exact_apply_members** — Recover only the explicitly confirmed candidates from one retained source snapshot, with no substitutions.
- **trackly_list_apply_review_handoffs** — Rediscover active, nonexpired review-handoff receipts for one execution without browser or profile values.
- **trackly_claim_apply_review_handoff** — Claim one exact handoff receipt and classify every member before grouped submission reconciliation.
- **trackly_get_apply_execution_snapshot**: Fetch a compact bounded projection of current members, requested profile keys, mutability, allowed operations, milestones, lease timing, and the authoritative funnel.
- **trackly_resume_parked_apply_member**: Resume one parked member only after explicit user instruction; a fresh non-mutating access probe remains required before form mutation.
- **trackly_approve_apply_execution_resume**: Approve one exact resume identity for an execution's unchanged original snapshot while preserving immediate per-run local verification before upload.
- **trackly_advance_apply_execution** — Transactionally select the next wave from the execution's original recent-first snapshot for the declared `browserSurface`. Returns a compact immutable `proposedWave` with each member's job ID and value-free `accessKnowledge`, plus the rich `accessProposal` receipt with member order, rationale, and approval hash. Same-key retries return identical identity, order, and rationale. Optional hash-bound `accessReviewApproval` probes exact proposed job IDs after personal deferments are cleared.
- **trackly_list_apply_access_deferments** — List the current user's persistent job/company/provider access deferments. Returns only scope identities; never provider names, URLs, or raw text.
- **trackly_defer_apply_access** — Persist an explicit user deferment for one Trackly `jobId` at `job`, `company`, or `provider` scope. The server derives company, provider, tenant, origin, and route; provider scope applies across companies until cleared; never submit a provider name, URL, or raw text.
- **trackly_clear_apply_access_deferment** — Clear one deferment listed or created in the current MCP session. Exact same-session replay is idempotent; after restart, refresh the active list instead of replaying an undiscovered cleared ID.
- **trackly_record_apply_execution_dispositions** — Record typed, value-free live-probe classifications for the current wave. Every item requires `jobId`, one allowed `classification`, `source: 'live_probe'`, and the exact `batchId`, `memberId`, `runId`, `expectedMemberVersion`, `expectedInspectionEpoch`, and `browserSurface`; cache/static scheduling records are server-owned and cannot be submitted through MCP.
- **trackly_stop_apply_execution** — Stop an execution with optimistic revision and idempotency guards.
- **trackly_create_apply_batch** — Freeze an exact recent-first set of approved jobs with an idempotency key.
- **trackly_cancel_apply_batch** — Retire a legacy fixed batch after explicit user confirmation while preserving job state, submitted work, and browser tabs.
- **trackly_get_active_apply_batch** — Recover the newest unexpired active batch before creating another after chat or browser context loss.
- **trackly_get_apply_batch** — Page a server-owned frozen batch without reordering or replacing members.
- **trackly_claim_apply_batch** — Acquire or renew the optimistic browser-mutation lease.
- **trackly_checkpoint_apply_batch** — Bulk-record up to 20 value-free inspection checkpoints, typed human actions, and per-member conflicts.
- **trackly_bind_apply_surface** — Bind an initial or recovered browser surface to the existing frozen member/run, increment its inspection epoch, and return the exact stored requisition URL.
- **trackly_record_apply_surface_evidence** — Record current-epoch, value-free inventory, missing-tab, close-receipt, post-close absence, or close-failure evidence.
- **trackly_record_apply_submission_evidence** — Record typed, redacted submit-request, success-page, explicit user-confirmation, or provider-receipt evidence without page text or external references.
- **trackly_approve_apply_batch_resume** — Approve one exact default-resume identity and content hash for the complete current frozen run set.
- **trackly_certify_apply_batch_truth** — Record an expiring late truthfulness certification over final answer and wording fingerprints after every other review-readiness gate has passed.
- **trackly_start_apply_run** — Start or reuse a manual-submit browser run with the complete frozen batch/member/lease binding.
- **trackly_get_apply_evidence** — Get the authenticated user's aggregate beta evidence and release gate without returning profile answers or contact values.
- **trackly_get_apply_protocol** — Get the current ATS support, browser integrity rules, and compatible skill version.
- **trackly_report_apply_observation** — Report redacted ATS mechanics and actual scenario coverage without answer values or page text.
- **trackly_report_apply_observations** — Bulk-report up to 20 leased, current-epoch, batch-bound redacted observations in one request.
- **trackly_record_application_outcome** — Record review readiness or a confirmed manual submission.
- **trackly_record_application_outcomes** — Bulk-record up to 20 leased, batch-bound outcomes while returning per-member conflicts explicitly.
- **trackly_prepare_resume** — Local MCP only: materialize the default resume in a private, expiring mode-0600 cache and return filename, size, SHA-256, exact local path, and visual-confirmation metadata. Hosted MCP returns a manual/local-agent requirement.
- **trackly_verify_prepared_resume** — Local MCP only: immediately before attachment, recompute the user-confirmed resume hash and size, validate the exact path/run/expiration, and lock the file read-only. Any mismatch requires a fresh preview and confirmation.
- **trackly_lint_application_text**: Local MCP only: require an explicitly complete claim-reference packet, then return a draft hash, length, and stable value-free writing violations without sending or echoing application text to Trackly.
- **trackly_diagnose_local_path**: Local MCP only: measure the exact implicated path's filesystem, inode, quota observability, and write-probe result without deleting user files or claiming a global disk cause.
- **trackly_validate_apply_tab_keep_set**: Local MCP only: fail closed unless a caller-supplied nonempty expected tab set exactly matches the keep set and is covered by complete controller and user inventories. This pure helper allows unrelated tabs, performs no browser action, and never sends tab IDs to Trackly.
- **trackly_validate_apply_resume_upload**: Local MCP only: validate the browser adapter's capabilities and ordered, value-free attachment proof stages. The default chooser path requires all six stages. Explicit `directFileSet: true` permits exact file-input targeting with `chooserArming: false` and four stages: `semantic_control_discovered`, `set_files_succeeded`, `user_facing_filename_committed`, `parser_fields_rechecked`. All shared verification capabilities remain required; omit chooser events on this path. This validates proof without opening a chooser, reading a path, controlling a browser, or sending form data to Trackly.

Apply contract v3 intentionally gives this verifier different local and hosted schemas: local MCP receives the full proof needed to inspect the private file, while hosted MCP accepts only run and confirmation identifiers and returns the manual/local-agent requirement. Local paths are never sent remotely. Resume fingerprints are sent only to authenticated Trackly resume approval and truth-certification endpoints, never observations or employer forms. Version 3.1 also records universal value-free evidence for critical-contact integrity and the manual-submit boundary. Version 3.2 authorizes the exact stored HTTPS origin for jobs Trackly ingested from employer careers sources, without granting redirect, iframe, or hostname-suffix privileges. Version 3.3.1 adds active-batch recovery, epoch-bound observations/outcomes, and truth certification for forms with no resume control. Version 3.4 adds server-owned accessible executions above immutable child batches, typed access dispositions, and an authoritative target-completion funnel.

Version 3.8.1 adds access-aware scheduling receipts, `nextAction: access_review`,
hash-bound probe approval, and job/company/provider deferment tools. Provider scope
applies across companies until explicitly cleared. Historical OPEN never
authorizes form filling; every selected job still requires a fresh non-mutating
live probe.

Version 3.7 adds public exact-member recovery and scoped review-handoff claims,
plus local tab-finalizer and resume-upload proof validators. Recovery candidates
are bounded and value-free. The local helpers perform no browser actions and
send no tab IDs, filenames, paths, page text, or form values to Trackly.

### Maintenance behavior

REST, refresh, download, CLI, and local/hosted MCP surfaces use canonical `code: "maintenance_mode"`; older `planned_maintenance` responses are accepted only as a compatibility alias. Structured errors retain HTTP and service status, retry time, estimated return, and request ID without clearing valid credentials. Maintenance is resumable rather than retryable: wait for the advertised window, refetch the Apply protocol and profile, then resume the existing `agent_browser` run. Never create a duplicate run or click Submit.

> **Why no `trackly_chat` here (intentional, not drift):** the hosted connector exposes one extra tool, `trackly_chat`, that runs a backend agent over these same primitives. The local MCP client is already an agent, so `trackly_chat` remains deliberately hosted-only.

### Example Prompts

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Show me jobs at Stripe"
- "Mark job 1234 as applied"
- "Show my Trackly preferences, then set Product to up to 2 years and Strategy to up to 5 years"
- "Use Trackly Apply to fill my next saved application and stop before Submit"

### Local and shared Apply contract versions

`contractVersion` identifies the complete local Apply schema, including local-only helpers. Optional `sharedContractVersion` identifies the unchanged hosted projection used for wire headers and backend compatibility; when absent it defaults to `contractVersion`. A local-only helper change may bump the local revision while pinning the unchanged shared projection. Shared tool or constant changes require the coordinated hosted contract review and version update; never relabel the captured hosted fixture as newer deployment evidence. Doctor JSON reports both identities.
