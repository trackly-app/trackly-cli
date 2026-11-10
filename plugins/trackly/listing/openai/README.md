# ChatGPT listing kit: trackly-openai 1.0.9

This kit is the portal companion for the ChatGPT app package `trackly-openai` 1.0.9. The package itself lives in close-ai at `docs/openai/trackly-openai-1.0.9/` (18 files, hashes in `docs/openai/trackly-openai-1.0.9.sha256`) and was deployed with close-ai #3604 (merge `6a5b05f5`, 2026-11-10 00:46 PST). [`metadata.json`](metadata.json) pins that source, and [`tools.json`](tools.json) is the 38-tool catalog captured from close-ai's `openai-tools-list.json` golden and directory registry at the same commit.

This is not the classic Codex plugin in `plugins/trackly/` (21 tools on `/api/plugin/trackly/mcp`). The ChatGPT app uses its own endpoint:

`https://mcp.usetrackly.app/api/plugin/trackly/openai/mcp`

## Portal order (Kevin's local session)

1. Confirm production serves the 38 tools (done on close-ai #3601 after the PR1 deploy).
2. In the OpenAI Platform portal, open the **existing** trackly app record and run **Rescan**. Never create a new app: a second app with the same MCP URL is rejected.
3. Wait until every new tool below is approved. Paste the justification column when the portal asks.
4. Upload the 1.0.9 package ZIP as an update to the same record and submit it for review. Submission and publication each need Kevin's separate approval, as `RELEASE-GATES.md` requires.

The 27 existing tool definitions are byte-identical to 1.0.8, so 1.0.8 skills keep working until 1.0.9 is approved.

## New tools

`openWorldHint` is false for every tool: each calls only Trackly's own API for the signed-in account.

| Tool | Read only | Destructive | Scopes | Justification |
| --- | --- | --- | --- | --- |
| `trackly_get_application_profile` | true | false | `profile:read` (`sensitive:read` with `includeSensitive`) | Reads the user's saved application answers. Equal-opportunity and identity-document answers report only answered, declined or blank. |
| `trackly_get_profile_onboarding` | true | false | `profile:read` | Reads which profile requirements are still missing and the profile revision. |
| `trackly_list_companies` | true | false | `jobs:read` | Lists the companies Trackly monitors, one page at a time. |
| `trackly_request_company` | false | false | `jobs:read`, `tracking:write` | Records a request for Trackly to review a company for monitoring. Deletes nothing. |
| `trackly_update_experience_limits` | false | true | `tracking:write` | Replaces the user's saved years-of-experience limits at an expected revision. |
| `trackly_get_apply_queue` | true | false | `apply:read` | Lists the jobs the user saved to check later. |
| `trackly_list_tracker_applications` | true | false | `tracking:read` | Lists the user's Tracker board entries. Contact names and emails are never returned. |
| `trackly_create_tracker_application` | false | true | `tracking:write`, `apply:write` | Adds a job the user confirms applying to as a Tracker entry; requires `explicitUserConfirmed: true`. |
| `trackly_update_tracker_stage` | false | true | `tracking:write` | Moves one Tracker entry to a new stage, with history and undo. |
| `trackly_add_tracker_note` | false | false | `tracking:write` | Adds a dated note to one Tracker entry without changing its stage. |
| `trackly_retract_tracker_event` | false | true | `tracking:write` | Undoes one Tracker event; it stays in history marked as retracted. |

## New review cases

Package 1.0.9 adds two positive cases to the review test set, for eight in total. Both are in the package manifest under `extensions.com.openai.review.test_cases`:

- `profile-setup-status`: "Show what my trackly profile already has and what setup still needs, without changing anything." Uses `trackly_get_profile_onboarding` and `trackly_get_application_profile`.
- `request-company`: "Is Example Robotics tracked by trackly? If not, ask trackly to monitor it." Uses `trackly_search_companies` and `trackly_request_company`.

The three negative cases (no automatic submission, no referral intelligence, no fabricated answers) are unchanged.

## Release notes (from the package manifest)

Adds tools to read the saved application profile and what setup still needs, list tracked companies, ask trackly to monitor a company, set years-of-experience limits and read the saved Apply queue. Equal-opportunity and identity-document answers are reported only as answered, declined or blank. Existing tool definitions, OAuth permissions, account isolation and manual submission remain unchanged.

## Rollback

Each new tool group can be switched off without a deploy through `TRACKLY_DIRECTORY_DISABLED_TOOL_GROUPS` (`openai:profile_read`, `openai:tracker`, `openai:request_company`, `openai:companies`, `openai:preferences`, `openai:apply_queue`). A switched-off tool stays listed and answers `temporarily_unavailable`. Prefer this to removing a tool: a removed tool may need approval again later.
