# Claude directory listing kit: Trackly connector v2

This kit is the material for the Claude directory listing edit that announces the v2 connector. It is a draft for Kevin's local session: Kevin owns the public copy and submits it at claude.ai/directory/manage. Nothing here signs in to a portal.

Connector URL: `https://mcp.usetrackly.app/api/plugin/trackly/claude/mcp`

[`metadata.json`](metadata.json) holds the structured fields and the consent lines approved on 2026-11-09. [`tools.json`](tools.json) is the catalog captured from close-ai's `claude-tools-list.json` and `claude-apply-allowlisted-tools-list.json` goldens and directory registry at deployed commit `6a5b05f5` (close-ai #3604).

## Listing text

**Name:** Trackly

**Tagline:** Find jobs, keep your Tracker current and prepare applications you submit yourself.

**Description:**

Trackly watches employers' career pages and shows you new openings that match your preferences. With the Trackly connector, Claude can:

- search current openings and companies Trackly monitors, and read your job preferences;
- show your saved Trackly application profile and what it still needs, and save answers you confirm;
- keep your Tracker board current: add a job you applied to, move it to a new stage, add notes and undo a change;
- ask Trackly to monitor a company it does not track yet;
- with the Trackly Apply skill and Claude in Chrome, fill an application you approved in your own browser and stop before Submit. You always submit it yourself.

Trackly never submits an application, never contacts an employer site from its servers, and reports equal-opportunity and identity-document answers only as answered, declined or blank. An account is required; Trackly is free and available in the United States.

**Example prompts:**

1. Find product manager jobs in California at companies Trackly monitors.
2. What does my Trackly profile still need?
3. Move my Speak application to rejected and note that the email came today.
4. Ask Trackly to monitor Example Robotics.
5. Prepare my application for the first job in my Apply queue and stop before Submit.

**Consent screen lines (deployed with close-ai #3604):**

- Search jobs and companies, and read your job preferences
- See and update your Trackly application profile, including sensitive answers you choose to share
- Move jobs on your Tracker and add notes
- Prepare job applications in your browser when you ask. You always submit them yourself
- Ask Trackly to monitor a company

## Tools

Destructive tools always ask the user before they run. `openWorldHint` is false for every tool: each calls only Trackly's own API for the signed-in account.

Listed for every user (21):

| Tool | Title | Annotations | Scopes | Flag group |
| --- | --- | --- | --- | --- |
| `trackly_search_jobs` | Search jobs | read-only | `jobs:read`, `tracking:read` | none |
| `trackly_get_job` | Get job details | read-only | `jobs:read`, `tracking:read` | none |
| `trackly_search_companies` | Search companies | read-only | `jobs:read` | none |
| `trackly_get_job_brief` | Get job brief | read-only | `jobs:read` | none |
| `trackly_get_preferences` | Get job preferences | read-only | `jobs:read` | none |
| `trackly_lint_application_text` | Check application text | read-only | `profile:read` | none |
| `trackly_update_status` | Update job status | destructive | `tracking:write` | none |
| `trackly_save_application_answers` | Save application answers | destructive | `profile:write` | none |
| `trackly_grant_sensitive_storage_consent` | Allow sensitive-answer storage | destructive | `profile:write`, `sensitive:write` | none |
| `trackly_revoke_sensitive_storage_consent` | Revoke sensitive-answer storage | destructive | `profile:write`, `sensitive:write` | none |
| `trackly_get_application_profile` | Get application profile | read-only | `profile:read` | `profile_read` |
| `trackly_get_profile_onboarding` | Get profile setup status | read-only | `profile:read` | `profile_read` |
| `trackly_list_companies` | List tracked companies | read-only | `jobs:read` | `companies` |
| `trackly_request_company` | Ask Trackly to monitor a company | non-destructive | `jobs:read`, `tracking:write` | `request_company` |
| `trackly_update_experience_limits` | Set years-of-experience limits | destructive | `tracking:write` | `preferences` |
| `trackly_list_tracker_applications` | List Tracker entries | read-only | `tracking:read` | `tracker` |
| `trackly_create_tracker_application` | Add a job to the Tracker | destructive | `tracking:write`, `apply:write` | `tracker` |
| `trackly_update_tracker_stage` | Move a Tracker entry | destructive | `tracking:write` | `tracker` |
| `trackly_add_tracker_note` | Add a Tracker note | non-destructive | `tracking:write` | `tracker` |
| `trackly_retract_tracker_event` | Retract a Tracker event | destructive | `tracking:write` | `tracker` |
| `trackly_get_apply_queue` | Get Apply queue | read-only | `apply:read` | `apply_queue` |

Trackly Apply, listed only for accounts on `TRACKLY_CLAUDE_APPLY_ALLOWLIST` until Anthropic approves this listing edit (16):

| Tool | Title | Annotations | Scopes | Flag group |
| --- | --- | --- | --- | --- |
| `trackly_list_apply_access_deferments` | List Apply access deferments | read-only | `apply:read` | `apply` |
| `trackly_defer_apply_access` | Defer Apply access | non-destructive | `apply:write` | `apply` |
| `trackly_clear_apply_access_deferment` | Clear an Apply access deferment | non-destructive | `apply:write` | `apply` |
| `trackly_start_or_resume_apply` | Start or resume Trackly Apply | destructive | `apply:read`, `apply:write` | `apply` |
| `trackly_get_apply_progress` | Get Apply progress | non-destructive | `profile:read`, `apply:read`, `apply:write` | `apply` |
| `trackly_get_apply_snapshot` | Get an Apply member snapshot | non-destructive | `profile:read`, `apply:read`, `apply:write` | `apply` |
| `trackly_approve_apply_resume` | Approve a resume for Apply | destructive | `apply:write` | `apply` |
| `trackly_bind_apply_surface` | Bind an Apply browser tab | non-destructive | `apply:write` | `apply` |
| `trackly_record_apply_dispositions` | Record Apply access results | non-destructive | `apply:write` | `apply` |
| `trackly_resume_parked_apply_member` | Resume a parked Apply member | destructive | `apply:write` | `apply` |
| `trackly_record_apply_observations` | Record Apply form observations | non-destructive | `apply:write` | `apply` |
| `trackly_advance_apply_execution` | Advance an Apply execution | non-destructive | `apply:write` | `apply` |
| `trackly_prepare_resume_artifact` | Get resume handoff | read-only | `apply:read` | `apply` |
| `trackly_certify_review_ready` | Mark an application ready for review | non-destructive | `apply:write` | `apply` |
| `trackly_reconcile_manual_submission` | Record a manual submission | destructive | `apply:write` | `apply` |
| `trackly_stop_apply` | Stop Trackly Apply | destructive | `apply:write` | `apply` |

On Claude, `browserSurface` accepts only `claude_in_chrome`. `trackly_prepare_resume_artifact` returns `nextAction: review_in_trackly_web` and no document identity, so the Claude skill never approves or binds a resume: the user attaches the exact file they approve, and the attachment stays unbound.

## Trackly Apply skill

The Apply procedure reaches Claude users through the published skill in `plugins/trackly-claude/`, released as two downloads with each trackly-cli release:

- `trackly-apply-claude-skill-<version>.zip` for claude.ai (Settings, Capabilities, Skills);
- `trackly-claude-plugin-<version>.zip`, a Claude Code plugin bundling the skill and this connector.

The skill reads typed state only (`nextAction` values and error codes), keeps the never-Submit, exact-file and navigation-origin rules, and uses only tools in [`tools.json`](tools.json); `npm test` and `npm run test:plugin-submission` enforce that.

## Release order

1. PR1 deployed with Apply allowlisted (done, close-ai #3604).
2. Real-client dry run in a fresh claude.ai session with only the published skill installed, on Kevin's account, stopping before Submit with a certified review-ready member.
3. Submit this listing edit at claude.ai/directory/manage, and send the Software Directory Policy section 3H material-change notice to `mcp-review@anthropic.com` (drafted for Kevin to send).
4. Only after Anthropic approves the edit: confirm `TRACKLY_APPLY_ACCESSIBLE_EXECUTION_ROLLOUT` is `all`, then set `TRACKLY_CLAUDE_APPLY_OPEN_TO_ALL=true`.

Rollback: `TRACKLY_DIRECTORY_DISABLED_TOOL_GROUPS` with `claude:<group>` switches a group off without a deploy; the tools stay listed and answer `temporarily_unavailable`.
