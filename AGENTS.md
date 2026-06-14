# AGENTS.md - trackly-cli

Universal context for AI coding agents (Codex, Cursor, Copilot, Claude Code, Devin, Jules, etc.)

## Project Overview

- **Product:** Trackly CLI + MCP Server — terminal access to 128K+ jobs across 1,900+ companies
- **Stack:** Node.js 18+ / plain CommonJS JavaScript (no TypeScript, no build step)
- **Package:** `npm install -g trackly-cli` (public npm package)
- **Backend API:** https://closeai.mba (same as Close AI — do NOT modify the backend from this repo)
- **Repo:** Public GitHub — `trackly-app/trackly-cli`

## Architecture

```
bin/trackly          # CLI entrypoint (shebang script). All commands + arg parser + main()
lib/client.js        # HTTP client: config loading, token refresh, apiRequest()
lib/formatters.js    # Terminal output: color(), outputJobs(), outputCompanies(), etc.
mcp/server.js        # MCP server: 11 tools, launched via `trackly mcp`
docs/trackly-tools.md  # MCP tool reference (for embedding in AI agent contexts)
server.json          # MCP Registry manifest (io.github.trackly-app/trackly)
```

## Dev Commands

```bash
# No build step — pure JS
node bin/trackly --help        # Run locally without installing
npm link                       # Symlink for local dev
```

There is a small Node test suite (`npm test`), no linter, and no build step. The package ships raw JS.

## Publishing

Publishing is fully automated via GitHub Actions:
1. Bump version in `package.json` + `package-lock.json` + `server.json` and merge to `main`
2. `auto-release.yml` creates a GitHub Release from the version bump (Releases page only — its `GITHUB_TOKEN` Release/tag does NOT trigger publishing)
3. `publish.yml` triggers on the same merge-to-main push (gated to version changes) and publishes to npm with provenance via **npm Trusted Publishing** (GitHub Actions OIDC, no token needed). Trusted Publisher configured at npmjs.com for `trackly-app/trackly-cli` + `publish.yml` workflow. Manual fallback: `gh workflow run publish.yml`.

**Do not run `npm publish` locally.** Manual publishes from a laptop have no OIDC context and would ship without provenance (this is what created the v0.2.7 unattested-release gap). If a manual publish is ever absolutely required as a break-glass measure, document why on the next CHANGELOG entry and plan a cosmetic version bump immediately after to restore the attestation chain via CI.

## Key Patterns

### Auth
- Google OAuth via local callback server (127.0.0.1, random port 19847-20847, 2-min timeout)
- Tokens stored in `~/.trackly/config.json` (file permissions 0600, directory 0700)
- On 401, `apiRequest()` tries one automatic refresh via `/api/auth/refresh` before failing
- `_isRetry` flag prevents infinite refresh loops

### MCP Server
- 11 tools: `trackly_search_jobs`, `trackly_get_job`, `trackly_search_companies`, `trackly_list_companies`, `trackly_get_stats`, `trackly_update_status`, `trackly_ask`, `trackly_get_job_brief`, `trackly_contacts_at_company`, `trackly_get_company_workspace`, `trackly_request_company`
- MCP User-Agent: `trackly-mcp/<version>` (from package.json)
- CLI User-Agent: `trackly-cli/<version>` (separate channel attribution)

### Output Modes
- `--json` flag or non-TTY stdout triggers JSON output on all commands
- TTY gets formatted, colored output via `lib/formatters.js`

## API Endpoints Used

All requests hit `https://closeai.mba` (configurable via `~/.trackly/config.json`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobscout/jobs` | List/filter jobs |
| GET | `/api/jobscout/jobs/:id` | Job detail |
| GET | `/api/jobscout/companies` | List companies |
| GET | `/api/jobscout/companies/search` | Semantic company search |
| GET | `/api/jobscout/me` | User stats |
| GET | `/api/jobscout/ask` | Natural language search (20/day limit) |
| POST | `/api/jobscout/tracker/jobs/:id/stage` | Update job tracker stage (applied/backlog/discarded) |
| POST | `/api/jobscout/companies/request` | Request a company be added (rate-limited) |
| POST | `/api/auth/api-key` | Create API key |
| GET | `/auth/google/cli` | OAuth login redirect |

## Common Pitfalls

1. **No build step.** This is plain CommonJS JS. Do not add TypeScript, ESM, or a bundler.
2. **Version is runtime-derived from `package.json`.** The `lib/client.js` and `mcp/server.js` files read version at runtime. Release-critical edits: `package.json` + `server.json`.
3. **Auth tokens at `~/.trackly/config.json`.** File permissions are 0600. Do not change.
4. **No dependencies beyond `@modelcontextprotocol/sdk` and `zod`.** Keep it minimal. HTTP uses raw `node:https`/`node:http`.
5. **The `ask` command has a 20/day rate limit** enforced server-side (429 response).
6. **Do not modify the backend.** This repo is a consumer of the Close AI API. Backend changes go in the `granola-followup-app` repo.
