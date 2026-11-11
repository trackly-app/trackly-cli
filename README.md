[![npm](https://img.shields.io/npm/v/trackly-cli.svg)](https://www.npmjs.com/package/trackly-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 20.20+ or 22.22+](https://img.shields.io/badge/node-20.20%2B%20%7C%2022.22%2B-brightgreen.svg)](https://nodejs.org/)
[![MCP Server](https://img.shields.io/badge/MCP-Server-blue.svg)](https://modelcontextprotocol.io/)

# trackly-cli

The only job tracking CLI built for AI agents.

Search 250K+ jobs across 5,400+ companies and 40+ ATS types. Track applications, get AI-powered recommendations, and manage your job search -- from the terminal or through Claude, ChatGPT, Cursor, and other MCP-compatible AI agents.

## Two ways to connect

### 🚀 Option 1: One-click in Claude co-work, Claude Desktop, ChatGPT (no install)

Use Trackly directly inside your AI — zero config:

1. Open Settings → Connectors → **Add custom connector**
2. URL: `https://mcp.usetrackly.app/api/mcp`
3. Click **Add** → sign in with Google → done

**[Full setup guide with screenshots →](https://usetrackly.app/connector)**

Works in: Claude co-work (web), Claude Desktop, ChatGPT Connectors, and any MCP client that supports remote/streamable-http connectors.

### 💻 Option 2: CLI install (for Cursor, Windsurf, or terminal use)

```bash
npm install -g trackly-cli    # may need: sudo npm install -g trackly-cli
trackly login
trackly jobs --function product
```

> **Prerequisites:** [Node.js 20.20+ or 22.22+](https://nodejs.org/) (LTS recommended). On macOS with the official `.pkg` installer, global npm installs may require `sudo`.

## At a Glance

5,400+ companies | 250K+ jobs | 40+ ATS types | CLI + MCP | 65 local + 62 hosted MCP tools

## CLI Commands

Trackly offers three different ways to handle an application. They are never mixed up:

| | What happens | How |
|---|---|---|
| **Trackly Apply (local)** | Your own AI agent (Claude in Chrome, Codex or computer use) fills the application in your browser on your computer and stops before Submit. You submit. | `trackly agent setup` installs the Trackly Apply (local) skill and MCP; then ask your agent to use Trackly Apply (local). |
| **Trackly Apply (cloud)** | You only request it. Trackly applies to the employer for you with your default resume (or `--resume-id`) and every saved profile answer, sensitive ones included, and notifies you; nothing runs on your computer. US Greenhouse, Lever and Ashby postings; each request counts toward your Trackly Apply (cloud) allowance. | `trackly auto-apply <jobId>`; check progress with `trackly auto-apply --status`. Agents use the MCP tools `trackly_auto_apply` and `trackly_auto_apply_status`. |
| **Mark applied** | You applied on your own and record it. The job also goes on your Tracker board. | `trackly mark-applied <jobId>` (`trackly apply <jobId>` does the same, for existing scripts). |

`trackly apply` with no job ID prints this summary.

Plan response errors in `--json` mode emit a structured object
on stdout and exit nonzero; check the exit code before treating output as a
successful result.

```bash
trackly jobs                          # List jobs
trackly jobs --remote                 # Filter remote jobs (sets usStates=REMOTE)
trackly jobs --region us              # Filter by region (us, non_us, all, or a region tag: europe, canada, remote, ...)
trackly jobs --job-type internship    # Filter by employment type (full_time, internship, all)
trackly jobs --work-arrangement hybrid,remote  # Filter by work arrangement independently
trackly jobs --function product       # Filter by function
trackly jobs --sponsorship exclude_no # Visa sponsorship filter (all, exclude_no, only_yes)
trackly jobs --company 243            # Filter by company ID
trackly job 1234                      # Get job details
trackly jobs 1234                     # Alias for job details
trackly companies                     # List companies
trackly companies search "fintech"    # Semantic company search
trackly search "fintech"              # Alias for semantic company search
trackly stats                         # Show metrics
trackly status                        # Alias for stats
trackly preferences                   # Show discovery preferences and experience limits
trackly preferences experience product=2 strategy=5  # Replace role-specific limits
trackly preferences experience clear # Turn role-specific experience filtering off
trackly apply                         # How to apply with Trackly (Trackly Apply (local), Trackly Apply (cloud), mark applied)
trackly mark-applied 1234             # Record a job you applied to yourself
trackly apply 1234                    # Same as mark-applied (kept for existing scripts)
trackly auto-apply 1234               # Request Trackly Apply (cloud): Trackly applies for you
trackly auto-apply --status           # List your Trackly Apply (cloud) requests
trackly auto-apply --help             # What Trackly Apply (cloud) does, next to the other two ways
trackly save 1234                     # Save a job
trackly dismiss 1234                  # Dismiss a job
trackly ask "PM jobs in SF"           # Natural language search
trackly contacts "Stripe"             # Search contacts at a company
trackly brief 1234                    # Get network brief for a job
trackly referral start 1234           # Start a referral campaign
trackly referral status 1234          # Check referral campaign status
trackly company-brief 243             # Get company brief (--refresh to regenerate)
trackly company-workspace 243         # Full company workspace view
trackly request-company "eBay"        # Request a company be added (--url, --notes optional)
trackly api-key create                # Generate API key
trackly api-key list                  # List API keys
trackly config                        # Show current CLI config
trackly config --api-key trk_xxx      # Save an API key for future commands
trackly version                       # Show installed version
trackly whoami                        # Show current user
trackly logout                        # Clear credentials
trackly agent setup --client both    # Install Trackly Apply (local) for Codex + Claude Code
trackly agent doctor                 # Verify setup, profile, resume, and compatibility
trackly agent diagnose-path /path/to/upload.pdf --errno ENOSPC --json  # Diagnose one exact local path
```

Search results set `autoApplySupported` to true for jobs Trackly Apply (cloud) can apply to (active US Greenhouse, Lever and Ashby postings); it does not decide Trackly Apply (local) eligibility. `trackly whoami` shows your plan when the server returns it. Plan refusals display server usage and reset information, plus an upgrade link only when the server provides one. Searches have no daily cap.

Add `--json` to any command for JSON output. Use `--api-key <key>` or `--base-url <url>` as one-off global flags when needed.

`trackly preferences --json` returns only `success`, `experienceFilterV2Available`, and `preferences`. The availability flag controls whether this client may edit role-specific limits; it does not claim that feed or alert enforcement is active. Every update checks that flag and the latest preference revision before writing.

## MCP Server Setup

### Hosted (Claude co-work, Claude Desktop, ChatGPT)

No install. In your AI tool, open **Settings → Connectors → Add custom connector** and enter:

```text
https://mcp.usetrackly.app/api/mcp
```

Sign in with Google when prompted. [Full visual guide →](https://usetrackly.app/connector)

Claude Code can use the same hosted server over OAuth:

```bash
claude mcp add --transport http trackly https://mcp.usetrackly.app/api/mcp
```

OAuth sign-in is the default for every client. An API key is optional and only
needed for headless clients that cannot complete an interactive sign-in: send
`Authorization: Bearer trk_...` with a key from **Settings → API Keys**.

Remote connections get 62 hosted tools. They share the search, company, status,
Tracker, and Apply tools with the local server and add `trackly_chat`; the 4 local-only
tools listed below are not available remotely. Hosted setup and tool details
are at [usetrackly.app/connector](https://usetrackly.app/connector).

### Trackly Apply (local) skill for Claude

If you connected Trackly from the Claude directory, the Trackly Apply (local) skill
teaches Claude to finish your Apply setup and fill applications you approved
in your own browser with Claude in Chrome. It stops before Submit; you always
submit yourself. Each [GitHub release](https://github.com/trackly-app/trackly-cli/releases)
attaches two downloads built from [`plugins/trackly-claude`](plugins/trackly-claude):

- `trackly-apply-claude-skill-<version>.zip`: upload it in claude.ai under Settings, Capabilities, Skills.
- `trackly-claude-plugin-<version>.zip`: a Claude Code plugin with the skill and the Claude connector. See its [README](plugins/trackly-claude/README.md) to install it.

Trackly Apply (local) on the Claude connector is enabled per account while the
updated directory listing is in review.

### Local (CLI via stdio, for Cursor / Windsurf / Claude Code)

For agent-assisted form filling on macOS, install the public skill and local MCP together:

```bash
trackly agent setup --client codex    # or claude / both
trackly agent doctor
```

For an existing MCP configuration or a Cloud harness, use `trackly agent setup --client both --skills-only`. This installs the same checksummed skill for both native clients without invoking their MCP commands or changing authentication. CLI 0.20.1 carries universal skill 4.9.1; its policy revision is the same numeric version, superseding the personal revisions. The policy accepts a documented `markHandoff()` guarantee with awaited calls, exact current tab checks, and revalidation on later turns. These observations are never reported as returned persistence receipts. Browser capabilities and manual Submit remain separate requirements; installation does not make a Linux browser supported. The separately installed `trackly:trackly-apply` plugin is updated through its plugin manager; plugin 1.1.1 carries the same browser and profile lookup policies. This setup command does not patch plugin caches.

The skill uses the profile and default resume in your Trackly account, asks only missing questions, fills user-approved saved jobs, and always stops before Submit. “Fill the next N” continues through the original recent-first Check Later snapshot until N unauthenticated forms are durably ready for your manual review; authentication walls and exclusions are reported separately and do not consume the target. An explicit “inspect the next N records” request still uses one fixed immutable batch. Support is fetched from Trackly at the start of every run: Greenhouse is full, Ashby and Lever are best effort, and 27 additional named ATS/provider classes use constrained guided mode. Employer-hosted unknown forms run only when Trackly binds them to a verified company domain. LinkedIn-hosted forms and unverified origins remain manual-only; a separately stored external application URL is evaluated under its own ATS and origin policy.

Guided mode is deliberately fail-closed. The agent stops on credential entry, OTP/email verification, CAPTCHA/human verification, an unexpected employer or origin, a submit-only transition, or any field whose committed state cannot be observed. `trackly agent doctor` checks the local skill, MCP registration, protocol compatibility, declared browser/computer-use configuration, profile completeness, and default-resume metadata. Live semantic browser capability and the exact resume bytes are verified at the start of a real run.

#### Claude Code one-liner

```bash
claude mcp add --scope user trackly -- trackly mcp
```

Or equivalently:

```bash
claude mcp add-json --scope user trackly '{"command":"trackly","args":["mcp"]}'
```

#### Claude Code manual config

Add to a project-scoped `.mcp.json`:

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

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json` (same schema works for Windsurf):

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

Then use natural language in any of these clients:

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Mark job 1234 as applied"

### Search filters and updates

`trackly_search_jobs` supports multiple roles and regions, US states and Canadian
provinces, internship education levels, favorite companies, posting windows,
annual USD salary floors, incremental sync, work arrangement, sponsorship and
pipeline status. [Exact values and examples](docs/trackly-tools.md#available-tools).
Search returns 20 jobs by default; request up to 100 and use `offset` to page.

For sponsorship, “exclude no” keeps yes **and not mentioned**. Use `exclude_no`;
`only_yes` excludes jobs with unknown sponsorship. Ask the user when intent is
ambiguous. Salary floors also keep unknown and non-comparable salaries visible.
Unsupported industry/specialization/literal-search controls are rejected.

For a local server without a global package install, run `npx -y trackly-cli mcp`.
For Codex, use `codex mcp add trackly -- npx -y trackly-cli mcp`; Cursor and
Windsurf can use `"command": "npx", "args": ["-y", "trackly-cli", "mcp"]`.
Authenticate with `npx -y trackly-cli login` first, or configure `TRACKLY_API_KEY`.

Existing global installs require `npm install --global trackly-cli@latest`.
Restart the MCP process/client and refresh tool discovery after updating.
For native skills and marketplace plugin updates, follow the
[release and update guide](docs/release-verification.md#existing-public-users).
Hosted and local releases are separate: the current client schema is authoritative.

## MCP Tools Reference

The local stdio server (`trackly mcp`) registers the 65 tools below. Four are
local-only because they run their checks on your machine:
`trackly_diagnose_local_path`, `trackly_lint_application_text`,
`trackly_validate_apply_resume_upload`, and `trackly_validate_apply_tab_keep_set`.
The currently deployed hosted server has 62 hosted tools, including the five Tracker tools and the two Trackly Apply (cloud) tools.

Every tool has a family title (`<Family> · <Action>`), and its description starts with the family tag, for example `[Tracker]`. Tool names never change.

### Jobs

| Title | Tool | Description |
|-------|------|-------------|
| Jobs · Search | trackly_search_jobs | Search by roles, regions, states/provinces, internship level, favorites, recency, annual USD salary floor, sponsorship, work arrangement, and pipeline status |
| Jobs · Get details | trackly_get_job | Get details by Trackly ID, with availability and retry guidance |
| Jobs · Ask in plain language | trackly_ask | Natural language job search |

### Companies

| Title | Tool | Description |
|-------|------|-------------|
| Companies · Search | trackly_search_companies | Semantic company search |
| Companies · List tracked | trackly_list_companies | List all tracked companies |
| Companies · Request monitoring | trackly_request_company | Request a company be added to Trackly (rate-limited to 5 pending) |

### Network

| Title | Tool | Description |
|-------|------|-------------|
| Network · Get job brief | trackly_get_job_brief | Get a network brief, with availability and retry guidance |
| Network · Find contacts | trackly_contacts_at_company | Search contacts at a specific company |
| Network · Get company workspace | trackly_get_company_workspace | Full company workspace (jobs, contacts, hiring managers, campaigns) |

### Preferences

| Title | Tool | Description |
|-------|------|-------------|
| Preferences · Get | trackly_get_preferences | Read bounded discovery preferences, edit availability, and save revision |
| Preferences · Set experience limits | trackly_update_experience_limits | Atomically replace role-specific limits on a job's stated minimum years |

### Profile

| Title | Tool | Description |
|-------|------|-------------|
| Profile · Get | trackly_get_application_profile | Get versioned profile answers and provenance |
| Profile · Get setup status | trackly_get_profile_onboarding | Get schema plus missing questions |
| Profile · Update answers | trackly_update_application_profile | Save scoped answers with optimistic concurrency; revoking sensitive storage takes a two-step confirmation |
| Profile · Check answer text | trackly_lint_application_text | Locally lint application writing and return only value-free violations plus a draft hash |

### Job status

| Title | Tool | Description |
|-------|------|-------------|
| Job status · Mark applied, saved or dismissed | trackly_update_status | Record applied, saved or dismissed on your job list. Applied also records the job on the Tracker (one entry, never a duplicate) and returns `trackerEntry` |
| Job status · Get counts | trackly_get_stats | Job tracker metrics and status counts |

### Tracker

| Title | Tool | Description |
|-------|------|-------------|
| Tracker · List entries | trackly_list_tracker_applications | List Tracker board entries by stage, company or role text, or job ID; one entry with its events by applicationId |
| Tracker · Add a job | trackly_create_tracker_application | Add an application to the Tracker board without duplicates, mainly one that is not a Trackly job (`trackly_update_status` applied already adds Trackly jobs) |
| Tracker · Move stage | trackly_update_tracker_stage | Move one Tracker entry to a stage (rejected, interview, offer...) with an optional dated note |
| Tracker · Add note | trackly_add_tracker_note | Add a dated note to one Tracker entry without changing its stage |
| Tracker · Undo an event | trackly_retract_tracker_event | Undo one Tracker event the user names |

### Trackly Apply (local)

Your own AI agent fills the form in your browser and stops before Submit; you submit.

| Title | Tool | Description |
|-------|------|-------------|
| Trackly Apply (local) · Get queue | trackly_get_apply_queue | Get user-approved jobs ready for execution |
| Trackly Apply (local) · List deferments | trackly_list_apply_access_deferments | List persistent user access deferments |
| Trackly Apply (local) · Defer a job, company or provider | trackly_defer_apply_access | Persist a job or company deferment from a Trackly jobId |
| Trackly Apply (local) · Clear a deferment | trackly_clear_apply_access_deferment | Clear one discovered user access deferment |
| Trackly Apply (local) · Stop a run | trackly_stop_apply_execution | Stop an execution without changing saved-job state |

### Apply steps

Internal steps of a Trackly Apply (local) run. The Trackly Apply skill calls them with IDs from earlier steps; they are not standalone actions.

| Title | Tool | Description |
|-------|------|-------------|
| Apply step · Get protocol | trackly_get_apply_protocol | Get current workflow and compatibility rules |
| Apply step · Start a run | trackly_start_apply_execution | Start a target-counted accessible Apply execution |
| Apply step · Recover active run | trackly_get_active_apply_execution | Recover the active execution before legacy batch recovery |
| Apply step · Get run | trackly_get_apply_execution | Read the authoritative progress funnel and immutable child waves |
| Apply step · Get run snapshot | trackly_get_apply_execution_snapshot | Fetch a compact bounded projection for current execution members and required profile keys |
| Apply step · Advance run | trackly_advance_apply_execution | Transactionally create the next eligible immutable wave with frozen accessKnowledge |
| Apply step · Record access results | trackly_record_apply_execution_dispositions | Record typed, value-free access classifications |
| Apply step · Resume a parked job | trackly_resume_parked_apply_member | Explicitly resume one parked member for a fresh non-mutating access probe |
| Apply step · Approve resume for run | trackly_approve_apply_execution_resume | Approve one exact resume identity for an unchanged execution snapshot |
| Apply step · List recoverable runs | trackly_list_recoverable_apply_executions | List bounded exact-member recovery candidates after context loss |
| Apply step · Recover jobs from a run | trackly_recover_exact_apply_members | Recover only one explicitly confirmed candidate set without substitutes |
| Apply step · List review handoffs | trackly_list_apply_review_handoffs | Rediscover active, value-free review-handoff receipts for one execution |
| Apply step · Claim a review handoff | trackly_claim_apply_review_handoff | Claim and classify one exact review-handoff group before reconciliation |
| Apply step · Create batch | trackly_create_apply_batch | Freeze an exact recent-first approved batch |
| Apply step · Cancel batch | trackly_cancel_apply_batch | Retire a legacy fixed batch after explicit user confirmation |
| Apply step · Get batch | trackly_get_apply_batch | Read frozen membership with opaque pagination |
| Apply step · Recover active batch | trackly_get_active_apply_batch | Recover the newest unexpired active batch after context loss |
| Apply step · Claim batch lease | trackly_claim_apply_batch | Acquire or renew a batch mutation lease |
| Apply step · Checkpoint batch | trackly_checkpoint_apply_batch | Bulk-record redacted inspection checkpoints and human actions |
| Apply step · Bind browser tab | trackly_bind_apply_surface | Bind an initial or recovered browser surface to the existing run and exact requisition URL |
| Apply step · Record tab evidence | trackly_record_apply_surface_evidence | Record current-epoch inventory, missing-tab, close-receipt, and post-close absence evidence |
| Apply step · Record submission evidence | trackly_record_apply_submission_evidence | Record redacted submit-request, success-page, user-confirmation, or provider-receipt evidence |
| Apply step · Approve resume for batch | trackly_approve_apply_batch_resume | Approve one exact default resume for the current frozen run set |
| Apply step · Certify answers | trackly_certify_apply_batch_truth | Certify final answer and wording fingerprints after every other review-readiness gate |
| Apply step · Start a legacy run | trackly_start_apply_run | Start or reuse a manual-submit browser run |
| Apply step · Get beta evidence | trackly_get_apply_evidence | Get aggregate, value-free beta evidence and release readiness |
| Apply step · Report observation | trackly_report_apply_observation | Send redacted ATS mechanics feedback |
| Apply step · Report observations | trackly_report_apply_observations | Bulk-send up to 20 leased, batch-bound redacted observations |
| Apply step · Record run outcome | trackly_record_application_outcome | Record a Trackly Apply run receipt (review_ready, submitted, failed or blocked); a submitted receipt also reaches the Tracker |
| Apply step · Record run outcomes | trackly_record_application_outcomes | Bulk-record up to 20 leased batch run receipts with per-member conflicts; submitted receipts also reach the Tracker |
| Apply step · Prepare resume file | trackly_prepare_resume | Prepare a private expiring resume file for upload |
| Apply step · Verify resume file | trackly_verify_prepared_resume | Recheck the confirmed resume immediately before attachment |
| Apply step · Diagnose a local file path | trackly_diagnose_local_path | Locally diagnose the exact implicated filesystem path without deleting files |
| Apply step · Validate resume upload | trackly_validate_apply_resume_upload | Locally validate adapter capability and ordered value-free attachment proof stages |
| Apply step · Validate kept tabs | trackly_validate_apply_tab_keep_set | Locally validate an exact expected/keep tab set against complete caller-supplied inventories without controlling the browser or sending tab IDs remotely |

### Trackly Apply (cloud)

| Title | Tool | Description |
|-------|------|-------------|
| Trackly Apply (cloud) · Request | trackly_auto_apply | Trackly Apply (cloud): ask Trackly to apply to one job for the user (not Trackly Apply (local), which fills the form in the user's browser) |
| Trackly Apply (cloud) · Check requests | trackly_auto_apply_status | List the user's Trackly Apply (cloud) requests and their status |

### Feedback

| Title | Tool | Description |
|-------|------|-------------|
| Feedback · Report a missing tool | get_more_tools | Report a missing capability so Trackly can improve its MCP surface |

## Authentication

### Option 1: Google OAuth (recommended)

```bash
trackly login
```

Opens your browser for Google sign-in. Tokens are stored locally at `~/.trackly/config.json`.

Trackly is currently opening new memberships through a limited, invite-based
rollout. Existing members can keep using OAuth and API keys normally. If a new
account is not yet eligible, the CLI returns an invitation-specific message
instead of suggesting repeated login attempts; request a future seat at
[usetrackly.app/early-access](https://usetrackly.app/early-access).

### Option 2: API Key

Existing members can use an API key for firewalls, headless servers, or CI:

1. Sign in at [usetrackly.app](https://usetrackly.app)
2. Go to **Settings → API Keys → Create**
3. Save the key:

```bash
trackly config --api-key trk_xxxxxxxxxxxxxxxxxxxx
```

Or pass it per-command:

```bash
trackly --api-key trk_xxxxxxxxxxxxxxxxxxxx jobs --json
```

Or set it as an environment variable:

```bash
export TRACKLY_API_KEY=trk_xxxxxxxxxxxxxxxxxxxx
trackly jobs
```

### Generate a key from the CLI

If you're already logged in via OAuth, you can create a key without visiting the web app:

```bash
trackly api-key create --name "my-script"
trackly api-key list
```

### Other config

```bash
trackly config --clear-api-key           # Clear stored API key
trackly config --base-url http://127.0.0.1:3000  # Point at a different backend
```

## Comparison

| Feature | CLI | Web App | Public API |
|---------|-----|---------|------------|
| Job search + filters | Yes | Yes | Yes |
| Apply/save/dismiss | Yes | Yes | Yes |
| AI-powered search | Yes (trackly ask) | Yes | Yes |
| MCP integration | Yes (65 local tools) | -- | -- |
| Browser required | No | Yes | No |
| Best for | Terminal + AI agents | Visual browsing | Custom integrations |

Web: [usetrackly.app](https://usetrackly.app) | API docs: [usetrackly.app/developers](https://usetrackly.app/developers)

## Frequently Asked Questions

**How do I track job applications from the terminal?**

Install trackly-cli (`npm install -g trackly-cli`), authenticate with `trackly login` or configure an API key, then use `trackly jobs` to browse openings and `trackly mark-applied <id>` (or `trackly apply <id>`) for applications you submitted yourself. All data syncs with the Trackly web app at usetrackly.app.

**What MCP servers exist for job searching?**

trackly-cli includes a built-in MCP server with 65 tools: the complete Trackly
job-search and application set plus `get_more_tools`, which lets agents report
a missing capability. Run `trackly mcp` or use
`trackly agent setup --client claude`.

MCP usage analytics are part of the free Trackly service and relay through
Trackly so it can be debugged and improved; there is no account-level opt-out.
They exclude résumé text, profile answers, demographic or work-authorization
answers, and application notes. Client attribution uses a fixed family label;
errors use categories, and search text is retained only as length. Raw queries
and conversation text are excluded.

**How do I use Claude Code for job hunting?**

Add trackly as an MCP server in Claude Code. Then ask questions naturally: "Find PM jobs at fintech companies in SF", "What companies are hiring for engineering?", or "Mark job 1234 as applied." Claude will use trackly's MCP tools to search and manage your applications.

**What are the best CLI tools for job search?**

trackly-cli is the first dedicated job tracking CLI. It provides direct terminal access to 250K+ jobs across 5,400+ companies, with filters for job function, location, and work modality. It also integrates with AI agents via the Model Context Protocol (MCP).

## Security

- OAuth tokens stored in `~/.trackly/config.json` with 0600 permissions
- API keys can be stored in the same config file or passed per-command
- OAuth callback bound to 127.0.0.1 only
- Authenticated requests require HTTPS unless you are pointing at localhost
- HTTP requests time out instead of hanging indefinitely
- CSRF protection on login flow
- See [SECURITY.md](SECURITY.md) for vulnerability reporting

## License

MIT -- see [LICENSE](LICENSE)
