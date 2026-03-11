# trackly-cli

CLI + MCP server for the Trackly job tracker. Lets users search 99K+ jobs across 775+ companies from the terminal or through AI agents (Claude Code, Cursor) via MCP.

## Tech Stack

- **Runtime:** Node.js 18+ (pure JS, no build step, no TypeScript)
- **MCP SDK:** `@modelcontextprotocol/sdk` (stdio transport)
- **Validation:** `zod` (MCP tool input schemas)
- **Auth:** Google OAuth via local callback server, tokens stored in `~/.trackly/config.json`
- **API:** All requests go to `https://closeai.mba` (the backend, same as CLOSE AI)

## Directory Structure

```
bin/trackly          # CLI entrypoint (shebang script). All 19 commands + arg parser + main()
lib/client.js        # HTTP client: config loading, token refresh, apiRequest()
lib/formatters.js    # Terminal output: color(), outputJobs(), outputCompanies(), outputStats(), outputContacts(), outputReferralCampaign(), outputNetworkBrief()
mcp/server.js        # MCP server: 9 tools, launched via `trackly mcp`
docs/trackly-tools.md  # MCP tool reference (for embedding in AI contexts)
server.json          # MCP Registry manifest (io.github.kevinastuhuaman/trackly)
```

## Key Commands

```bash
# No build step -- pure JS
node bin/trackly --help        # Run locally without installing
npm link                       # Symlink for local dev
npm publish                    # Publish to npm (needs npm login)
```

There is no test suite, no linter, and no build step. The package ships raw JS.

## How the MCP Server Works

1. User runs `trackly mcp` (or AI agent spawns it via stdio)
2. `bin/trackly` delegates to `mcp/server.js`
3. `mcp/server.js` creates an `McpServer` with 9 tools, connects via `StdioServerTransport`
4. Each tool calls `apiRequest()` from `lib/client.js` with a `trackly-mcp/<version>` User-Agent derived from `package.json`
5. CLI commands use `trackly-cli/<version>` User-Agent derived from `package.json` (separate channel attribution)

MCP setup for Claude Code:
```bash
claude mcp add-json trackly '{"command":"trackly","args":["mcp"]}'
```

The 9 MCP tools: `trackly_search_jobs`, `trackly_get_job`, `trackly_search_companies`, `trackly_list_companies`, `trackly_get_stats`, `trackly_update_status`, `trackly_ask`, `trackly_get_job_brief`, `trackly_contacts_at_company`

## Publishing

```bash
# Bump version in TWO places before publishing:
# 1. package.json         → runtime version for CLI + MCP User-Agent strings
# 2. server.json          → manifest "version" + packages[0].version
npm publish
```

CI/CD: GitHub Actions handles automated testing and npm publishing with provenance.

## API Endpoints Used

All requests hit `https://closeai.mba` (configurable via `~/.trackly/config.json`):

- `GET /api/jobscout/jobs` -- List/filter jobs
- `GET /api/jobscout/jobs/:id` -- Job detail
- `GET /api/jobscout/companies` -- List companies
- `GET /api/jobscout/companies/search` -- Semantic company search
- `GET /api/jobscout/me` -- User stats
- `GET /api/jobscout/ask` -- Natural language search (20/day limit)
- `POST /api/jobscout-tracker/status` -- Update job status (applied/saved/dismissed)
- `POST /api/auth/api-key` -- Create API key
- `GET /api/auth/api-keys` -- List API keys
- `GET /api/auth/user` -- Current user info
- `POST /api/auth/refresh` -- Token refresh
- `GET /api/network/people` -- List/search contacts
- `POST /api/network/jobs/:id/referral-campaign` -- Start referral campaign
- `GET /api/network/jobs/:id/referral-campaign` -- Get referral campaign status
- `GET /api/jobscout/jobs/:id/network-brief` -- Get network brief for a job
- `GET /auth/google/cli` -- OAuth login redirect

## Gotchas

1. **Version is runtime-derived from `package.json`.** Release-critical version edits are `package.json` and `server.json`. `lib/client.js` and `mcp/server.js` read `version` from `package.json` at runtime.
2. **No build step.** This is plain CommonJS JS. Do not add TypeScript, ESM, or a bundler.
3. **Auth tokens at `~/.trackly/config.json`.** File permissions are 0600, directory is 0700. Do not change this.
4. **OAuth callback binds to 127.0.0.1 only.** Port is randomized (19847-20847). 2-minute timeout.
5. **`--json` flag or non-TTY stdout** triggers JSON output mode on all commands.
6. **The `ask` command has a 20/day rate limit** enforced server-side (429 response).
7. **No dependencies beyond `@modelcontextprotocol/sdk` and `zod`.** Keep it minimal. The HTTP client uses raw `node:https`/`node:http`.
8. **Token refresh is automatic.** On 401, `apiRequest()` tries one refresh via `/api/auth/refresh` before failing. The `_isRetry` flag prevents infinite loops.
