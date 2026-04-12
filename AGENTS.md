# AGENTS.md - trackly-cli

Universal context for AI coding agents (Codex, Cursor, Copilot, Claude Code, Devin, Jules, etc.)

## Project Overview

- **Product:** Trackly CLI + MCP Server — terminal access to 128K+ jobs across 1,900+ companies
- **Stack:** Node.js 18+ / plain CommonJS JavaScript (no TypeScript, no build step)
- **Package:** `npm install -g trackly-cli` (public npm package)
- **Backend API:** https://closeai.mba (same as Close AI — do NOT modify the backend from this repo)
- **Repo:** Public GitHub — `kevinastuhuaman/trackly-cli`

## Architecture

```
bin/trackly          # CLI entrypoint (shebang script). All commands + arg parser + main()
lib/client.js        # HTTP client: config loading, token refresh, apiRequest()
lib/formatters.js    # Terminal output: color(), outputJobs(), outputCompanies(), etc.
mcp/server.js        # MCP server: 10 tools, launched via `trackly mcp`
docs/trackly-tools.md  # MCP tool reference (for embedding in AI agent contexts)
server.json          # MCP Registry manifest (io.github.kevinastuhuaman/trackly)
```

## Dev Commands

```bash
# No build step — pure JS
node bin/trackly --help        # Run locally without installing
npm link                       # Symlink for local dev
```

There is no test suite, no linter, and no build step. The package ships raw JS.

## Publishing

Publishing is fully automated via GitHub Actions:
1. Bump version in `package.json` + `server.json` and push to `main`
2. `auto-release.yml` creates a GitHub Release from the version bump
3. `publish.yml` publishes to npm with provenance using a CI-only `NPM_TOKEN` secret

**Do not run `npm publish` locally.** No local npm auth token is needed. If a manual publish is ever required as a break-glass measure, create a short-lived granular token just-in-time and revoke it immediately after.

## Key Patterns

### Auth
- Google OAuth via local callback server (127.0.0.1, random port 19847-20847, 2-min timeout)
- Tokens stored in `~/.trackly/config.json` (file permissions 0600, directory 0700)
- On 401, `apiRequest()` tries one automatic refresh via `/api/auth/refresh` before failing
- `_isRetry` flag prevents infinite refresh loops

### MCP Server
- 10 tools: `trackly_search_jobs`, `trackly_get_job`, `trackly_search_companies`, `trackly_list_companies`, `trackly_get_stats`, `trackly_update_status`, `trackly_ask`, `trackly_get_job_brief`, `trackly_contacts_at_company`, `trackly_get_company_workspace`
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
| POST | `/api/jobscout-tracker/status` | Update job status |
| POST | `/api/auth/api-key` | Create API key |
| GET | `/auth/google/cli` | OAuth login redirect |

## Common Pitfalls

1. **No build step.** This is plain CommonJS JS. Do not add TypeScript, ESM, or a bundler.
2. **Version is runtime-derived from `package.json`.** The `lib/client.js` and `mcp/server.js` files read version at runtime. Release-critical edits: `package.json` + `server.json`.
3. **Auth tokens at `~/.trackly/config.json`.** File permissions are 0600. Do not change.
4. **No dependencies beyond `@modelcontextprotocol/sdk` and `zod`.** Keep it minimal. HTTP uses raw `node:https`/`node:http`.
5. **The `ask` command has a 20/day rate limit** enforced server-side (429 response).
6. **Do not modify the backend.** This repo is a consumer of the Close AI API. Backend changes go in the `granola-followup-app` repo.
