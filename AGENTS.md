# AGENTS.md - trackly-cli

> Org-wide rules for every Trackly repo: https://github.com/trackly-app/.github/blob/main/AGENTS.md (needs org access). This file overrides it where they differ.

CLI + MCP server for the Trackly job tracker. Lets users search 250K+ jobs across 5,400+ companies from the terminal or through AI agents (Claude Code, Cursor) via MCP.

## Project Overview

- **Product:** Trackly CLI + MCP Server — terminal access to 250K+ jobs across 5,400+ companies
- **Stack:** Node.js `^20.20.0 || >=22.22.0` / plain CommonJS JavaScript (no TypeScript, no build step)
- **MCP SDK:** `@modelcontextprotocol/sdk` (stdio transport); **validation:** `zod` (MCP tool input schemas)
- **Auth:** Google OAuth via local callback server, tokens stored in `~/.trackly/config.json`
- **Package:** `npm install -g trackly-cli` (public npm package)
- **Repo:** Public GitHub — `trackly-app/trackly-cli`
- **Backend API:** `https://closeai.mba` (same backend as Close AI). This repo only consumes it. Never modify the backend or run SQL against production from this repo; backend operations are documented in private repositories, and backend changes belong in the private backend repository.

## Public Documentation Boundary

Document the public API and CLI/MCP contracts here. Backend infrastructure,
private source paths and internal tracking links belong in private repositories.
Workspace review notes stay local under ignored `.context/`; local review tools
can still read them without committing them to the public repository.

## Architecture

```
bin/trackly          # CLI entrypoint (shebang script). All CLI commands + arg parser + main()
lib/agent.js         # Agent setup, doctor, private resume cache, and public skill installation
lib/client.js        # HTTP client: config loading, token refresh, apiRequest()
lib/formatters.js    # Terminal output: color(), outputJobs(), outputCompanies(), outputStats(), outputContacts(), outputReferralCampaign(), outputNetworkBrief()
mcp/server.js        # MCP server entrypoint and search/network tools, launched via `trackly mcp`
mcp/apply-tools.js   # Trackly Apply MCP schemas, validators, and tool registration
contracts/           # Versioned hosted/local Trackly Apply MCP schema contract
skills/trackly-apply/  # Sanitized public browser-mechanics skill bundled with the CLI
scripts/             # Maintainer checks; the packaged audit verifier is the named exception
docs/trackly-tools.md  # MCP tool reference (for embedding in AI contexts)
docs/solutions/       # documented solutions organized by category with searchable YAML frontmatter (module, tags, problem_type)
CONCEPTS.md           # shared domain vocabulary for entities, named processes, and status concepts
server.json          # MCP Registry manifest (io.github.trackly-app/trackly)
```

## Dev Commands

```bash
# No build step — pure JS
node bin/trackly --help        # Run locally without installing
npm link                       # Symlink for local dev
```

There is a small Node test suite (`npm test`), no linter, and no build step. The package ships raw JS.

## How the MCP Server Works

1. User runs `trackly mcp` (or AI agent spawns it via stdio)
2. `bin/trackly` delegates to `mcp/server.js`
3. `mcp/server.js` creates an `McpServer` with 58 tools, connects via `StdioServerTransport`
4. Each tool calls `apiRequest()` from `lib/client.js` with a `trackly-mcp/<version>` User-Agent derived from `package.json`
5. CLI commands use `trackly-cli/<version>` User-Agent derived from `package.json` (separate channel attribution)

The 58 MCP tools include the complete search, network, profile, and Trackly
Apply set documented in `docs/trackly-tools.md` plus the analytics-owned
`get_more_tools` missing-capability tool. Keep this count synchronized with
`mcp/server.js`, `README.md`, and the docs-drift tests.

Job function values — **14 canonical values** that match the backend job-function contract and the local mirror `JOB_FUNCTIONS` in `mcp/server.js`: `product`, `engineering`, `design`, `data`, `marketing`, `sales`, `partnerships`, `finance`, `strategy`, `operations`, `people`, `legal`, `support`, `other`. `partnerships` is documented in CHANGELOG `0.2.1`; any doc still listing 13 values is stale. The MCP test at `test/mcp-schema.test.js` locks this local/backend mapping.

NOTE: `/ask` lives in the backend and historically emitted `product_management`/`data_science` style values that the `/jobs` handler could drop. Do not document that drift as fixed/live until a backend release verifies the modern public names (`product`, `data`, etc.).


## Publishing

Publishing is fully automated via GitHub Actions:
1. Bump the version in `package.json`, `package-lock.json`, and `server.json` (run `npm version <patch|minor> --no-git-tag-version` for the first two, then edit `server.json`) and add a CHANGELOG entry in a reviewed PR; merge the PR to `main`
2. `auto-release.yml` creates a GitHub Release from the version bump (Releases page only — its `GITHUB_TOKEN` Release/tag does NOT trigger publishing)
3. `publish.yml` triggers on the same merge-to-main push (gated to version changes) and publishes to npm with provenance via **npm Trusted Publishing** (GitHub Actions OIDC, no token needed). It also publishes to the MCP Registry. Trusted Publisher configured at npmjs.com for `trackly-app/trackly-cli` + `publish.yml` workflow. Manual fallback if a publish ever needs re-triggering: `gh workflow run publish.yml` (a PAT-authed dispatch fires the workflow; `GITHUB_TOKEN`-created Releases/tags do not).

**Do not run `npm publish` locally.** No npm auth token is needed (OIDC). Manual publishes from a laptop have no OIDC context and would ship without provenance (this is what created the v0.2.7 unattested-release gap). If a manual publish is ever absolutely required as a break-glass measure, document why on the next CHANGELOG entry and plan a cosmetic version bump immediately after to restore the attestation chain via CI.

Merge with merge commits only (the org rule); never `--squash` or `--rebase` in this repo.

### Mandatory release and installation verification (Kevin, 2026-10-10)

Every Trackly CLI upgrade must complete [release verification](docs/release-verification.md).
The purpose is to keep the current Trackly tools available to CLI, local MCP,
hosted MCP and plugin users. Publication alone is not global installation parity.
Verify the actual published package and attestations, complete tool names and
schemas on each applicable MCP surface, skill/plugin versions and hashes, and
the M1, M4, Conductor Cloud and current Codex Cloud installations. Verify the
shared Conductor image separately from retained workspace homes. Refresh local
MCP processes and check discovery again after upgrading their package.

Record unavailable or stale surfaces as incomplete; never convert another
agent report, a successful setup prompt or an old receipt into current proof.
Document the supported update path for existing public users, including plugin
manager updates and client discovery refresh. Publishing to npm does not
automatically upgrade existing global installs. Unrelated agent-tool or npm
dependency updates are separate maintenance unless compatibility or security
requires them for this release.

### Coordinated Trackly Apply release gate

The standalone CLI CI validates its checked-in hosted-tool contract fixture with
`npm run test:contract-fixture`. Before merging any release that changes Trackly
Apply schemas, also run the cross-repository comparison against the final backend
candidate:

```bash
TRACKLY_BACKEND_DIR=/absolute/path/to/backend-candidate npm run test:hosted-contract
```

This coordinated check belongs in the release evidence. Standalone CLI CI must
not depend on a sibling private checkout that does not exist on its runner.

### Unmerged Apply contract candidates

Run `TRACKLY_BACKEND_DIR=/path/to/clean/backend TRACKLY_BACKEND_SHA=<full-40-character-commit> npm run test:candidate-contract`
against the exact independently reviewed backend commit. This verifies current
shared contracts, executable tool schemas, and coordinated checkpoint helpers.
It requires a clean backend checkout and rejects another HEAD. It does not
replace `test:hosted-contract`, which remains pinned to the reviewed deployed
runtime and its recorded merge. The checked-in historical fixture retains its
captured Apply version; do not relabel it as evidence for a newer deployment.
A candidate pass is not release approval or proof of production deployment.

## Key Patterns

### Auth
- Google OAuth via local callback server (127.0.0.1, OS-assigned ephemeral port via `listen(0)` with a 1024-65535 guard, 5-min timeout, single SIGINT handler cleans up on Ctrl-C)
- Tokens stored in `~/.trackly/config.json` (file permissions 0600, directory 0700)
- On 401, `apiRequest()` tries one automatic refresh via `/api/auth/refresh` before failing
- `_isRetry` flag prevents infinite refresh loops

### MCP Server
- Search/network tools plus the versioned Trackly Apply tool set. Hosted/local Apply schemas must remain in contract parity; `trackly_prepare_resume` is local-only behavior. The hosted facade offers private original-resume preview and exact-file approval; actual attachment depends on host capabilities, with an explicit manual fallback.
- **Intentionally hosted-only:** `trackly_chat` is a backend agent for classic-UI surfaces, while CLI/MCP clients already are agents. `get_more_tools` is shared by hosted and local MCP as a value-free, structured capability-gap signal. This exact asymmetry is reviewed by the hosted-contract verifier; no other hosted-only tool is allowed.
- MCP User-Agent: `trackly-mcp/<version>` (from package.json)
- CLI User-Agent: `trackly-cli/<version>` (separate channel attribution)
- Flag validation is **command-level** (`COMMAND_FLAGS` in `bin/trackly`): it rejects unknown/wrong-command flags + typos (with a "did you mean" hint), but does not reject a flag that's valid on a sibling subcommand yet ignored by the handler (e.g. `api-key list --name foo`). Deliberate — subcommand-strict scoping would risk false-rejects, which are worse than a silently-ignored flag.

### Output Modes
- `--json` flag or non-TTY stdout triggers JSON output on all commands
- TTY gets formatted, colored output via `lib/formatters.js`

## API Endpoints Used

All requests hit `https://closeai.mba` (configurable via `~/.trackly/config.json`):

- `GET /api/jobscout/jobs` -- List/filter jobs
- `GET /api/jobscout/jobs/:id` -- Job detail
- `GET /api/jobscout/companies` -- List companies
- `GET /api/jobscout/companies/search` -- Semantic company search
- `GET /api/jobscout/me` -- User stats and discovery preferences
- `PUT /api/jobscout/preferences` -- Atomic discovery-preference updates
- `GET /api/jobscout/ask` -- Natural language search (20/day limit)
- `POST /api/jobscout/companies/request` -- Request a company be added (rate-limited, 5 pending max)
- `POST /api/jobscout/tracker/jobs/:id/stage` -- Update job tracker stage (`applied`/`backlog`/`discarded`; CLI maps apply/save/dismiss)
- `GET /api/jobscout/apply/queue` -- Get the user's approved application queue (`trackly_get_apply_queue`)
- `GET /api/jobscout/application-profile` -- Get the versioned application profile (`trackly_get_application_profile`)
- `GET /api/jobscout/application-profile/schema` -- Get profile fields and onboarding questions (`trackly_get_profile_onboarding`)
- `PATCH /api/jobscout/application-profile` -- Update profile answers with optimistic concurrency (`trackly_update_application_profile`)
- `POST /api/jobscout/apply/executions` -- Start a server-owned accessible execution (`trackly_start_apply_execution`)
- `GET /api/jobscout/apply/executions/active` -- Recover the active accessible execution (`trackly_get_active_apply_execution`)
- `GET /api/jobscout/apply/executions/:executionId` -- Read authoritative execution progress (`trackly_get_apply_execution`)
- `GET /api/jobscout/apply/executions/recoverable` -- List bounded exact-member recovery candidates (`trackly_list_recoverable_apply_executions`)
- `POST /api/jobscout/apply/executions/recover` -- Recover only one explicitly confirmed candidate set (`trackly_recover_exact_apply_members`)
- `GET /api/jobscout/apply/executions/:executionId/review-handoffs` -- List active grouped reconciliation receipts (`trackly_list_apply_review_handoffs`)
- `POST /api/jobscout/apply/review-handoffs/:handoffId/claim` -- Claim one exact grouped reconciliation receipt (`trackly_claim_apply_review_handoff`)
- `POST /api/jobscout/apply/executions/:executionId/snapshot` -- Read a bounded execution/profile projection (`trackly_get_apply_execution_snapshot`)
- `POST /api/jobscout/apply/executions/:executionId/parked/:memberId/resume` -- Request a fresh probe for an explicitly resumed parked job (`trackly_resume_parked_apply_member`)
- `POST /api/jobscout/apply/executions/:executionId/resume-approval` -- Approve one exact resume across an immutable execution snapshot (`trackly_approve_apply_execution_resume`)
- `POST /api/jobscout/apply/executions/:executionId/advance` -- Select the next immutable child wave (`trackly_advance_apply_execution`)
- `GET /api/jobscout/apply/access-deferments` -- List persistent user access deferments (`trackly_list_apply_access_deferments`)
- `POST /api/jobscout/apply/access-deferments` -- Persist a job or company deferment from a Trackly jobId (`trackly_defer_apply_access`)
- `POST /api/jobscout/apply/access-deferments/:defermentId/clear` -- Clear one discovered user access deferment (`trackly_clear_apply_access_deferment`)
- `POST /api/jobscout/apply/executions/:executionId/dispositions` -- Record bound value-free probe classifications (`trackly_record_apply_execution_dispositions`)
- `POST /api/jobscout/apply/executions/:executionId/stop` -- Stop an active execution idempotently (`trackly_stop_apply_execution`)
- `POST /api/jobscout/apply/batches/:batchId/cancel` -- Retire a legacy fixed batch after explicit user confirmation (`trackly_cancel_apply_batch`)
- `GET /api/jobscout/apply/batches/:batchId` -- Page one exact frozen batch (`trackly_get_apply_batch`)
- `POST /api/jobscout/apply/batches/:batchId/claim` -- Acquire or renew its browser-mutation lease (`trackly_claim_apply_batch`)
- `POST /api/jobscout/apply/batches/:batchId/members/:memberId/surface-binding` -- Bind an initial or recovered browser surface to the existing frozen member/run (`trackly_bind_apply_surface`)
- `POST /api/jobscout/apply/runs` -- Start an agent-assisted application run (`trackly_start_apply_run`)
- `GET /api/jobscout/apply/protocol` -- Get the versioned browser workflow (`trackly_get_apply_protocol`)
- `POST /api/jobscout/apply/observations` -- Report a redacted ATS observation (`trackly_report_apply_observation`)
- `POST /api/jobscout/apply/runs/:runId/outcome` -- Record review or submission outcome (`trackly_record_application_outcome`)
- `GET /api/jobscout/application-profile/default-resume` -- Download the default resume into the private local cache (`trackly_prepare_resume`)
- `POST /api/auth/api-key` -- Create API key
- `GET /api/auth/api-keys` -- List API keys
- `GET /api/auth/user` -- Current user info
- `POST /api/auth/refresh` -- Token refresh
- `GET /api/network/people` -- List/search contacts
- `POST /api/network/jobs/:id/referral-campaign` -- Start referral campaign
- `GET /api/network/jobs/:id/referral-campaign` -- Get referral campaign status
- `GET /api/jobscout/jobs/:id/network-brief` -- Get network brief for a job
- `GET /api/network/companies/:id/brief` -- Get company brief
- `POST /api/network/companies/:id/brief/refresh` -- Refresh/generate company brief
- `GET /api/network/companies/:id/workspace` -- Get company workspace (jobs, contacts, campaigns)
- `GET /auth/google/cli` -- OAuth login redirect

The complete 58-tool inventory is in `docs/trackly-tools.md`. Helpers such as `trackly_verify_prepared_resume` and `trackly_validate_apply_resume_upload` intentionally have no CLI HTTP endpoint and therefore do not appear in the endpoint list above.

Hosted `/api/mcp` tool count: the backend owns the hosted registry. It omits exactly four local-only tools (`trackly_diagnose_local_path`, `trackly_lint_application_text`, `trackly_validate_apply_resume_upload`, `trackly_validate_apply_tab_keep_set`) and adds `trackly_chat`, for 55. `trackly_prepare_resume` and `trackly_verify_prepared_resume` are registered on both servers. When a tool is added to or removed from either server, recount the hosted names and update every "N hosted tools" claim in `README.md`; the docs-coverage test only checks that those README claims agree.

## Common Pitfalls

1. **No build step.** This is plain CommonJS JS. Do not add TypeScript, ESM, or a bundler.
2. **Version is runtime-derived from `package.json`.** Release-critical version edits are `package.json` and `server.json`. `lib/client.js` and `mcp/server.js` read `version` from `package.json` at runtime.
3. **Auth tokens at `~/.trackly/config.json`.** File permissions are 0600, directory is 0700. Do not change this.
4. **OAuth callback binds to 127.0.0.1 only.** Port is OS-assigned (ephemeral via `listen(0)`, validated to 1024-65535 — the backend's accepted range). 5-minute timeout. A single `cmdLogin`-scoped SIGINT handler closes the callback server on Ctrl-C.
5. **`--json` flag or non-TTY stdout** triggers JSON output mode on all commands.
6. **The `ask` command has a 20/day rate limit** enforced server-side (429 response).
7. **Keep dependencies minimal.** Direct runtime dependencies are
   `@modelcontextprotocol/sdk`, `@posthog/mcp`, `posthog-node`, `zod`, Hono, and
   the security pins `fast-uri` and `ip-address`, which are declared directly
   *and* overridden (together with `qs` and `@hono/node-server`) so the SDK's
   audited patched resolution is guaranteed at every depth. The pins must be reviewed and bumped manually
   when upstream constraints change. PostHog is MCP-only and relays through
   Trackly's backend; no project key or numeric user ID is stored locally. The
   local MCP transport remains stdio-only; do not add or initialize an HTTP
   server. The CLI HTTP client uses raw `node:https`/`node:http`.
   Hono is declared directly to guarantee the audited patched resolution used
   by the SDK.
8. **Token refresh is automatic.** On 401, `apiRequest()` tries one refresh via `/api/auth/refresh` before failing. The `_isRetry` flag prevents infinite loops.
9. **`/ask` backend drift is tracked outside this repo.** The CLI and MCP use DB-backed job function values directly. The backend tracks the `/ask` prompt/URL migration to those same public values; verify production before claiming `/ask` round-trips are fixed.
