# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.6] - 2026-05-13

### Changed

- **MCP Registry namespace migrated from `io.github.kevinastuhuaman/trackly` → `io.github.trackly-app/trackly`.** The `trackly-cli` repo and its 7 sibling Trackly repos (TracklyApp, TracklyMac, TracklyWeb, close-ai, homebrew-trackly, trackly-cli-video, TracklyAndroid) moved from Kevin's personal GitHub account to the `trackly-app` GitHub Organization on 2026-05-13. Co-founder Jasmine Rattan now holds proper Admin role on each repo (impossible on user-owned repos — see `github-user-repo-permission-limits` memory). The MCP Registry derives publish permissions from the repo's GitHub owner via OIDC, so the namespace must reflect the new owner. **Existing installs at the old namespace continue working — the old MCP Registry entry remains active, and the npm package itself is unchanged.** New installs from Claude Code/Cursor/Codex will resolve `io.github.trackly-app/trackly` going forward. The old entry will be flagged as `deprecated` with a status message pointing to the new namespace.
- **Repository URL updated** in `package.json` + `server.json` from `github.com/kevinastuhuaman/trackly-cli` → `github.com/trackly-app/trackly-cli`. GitHub redirects keep old `git clone` and API calls working indefinitely, but downstream tooling should use the canonical URL.

### Fixed

- **CI: MCP Registry publish step was failing.** v0.2.5's release auto-published to npm but the MCP Registry sync step (in `publish.yml`) failed at `mcp-publisher login github-oidc` with `failed to validate OIDC token: invalid audience: expected https://registry.modelcontextprotocol.io, got [mcp-registry]`. Upstream `mcp-publisher` v1.7.6 (Apr 30, 2026) bound the OIDC token exchange to a per-deployment audience, fixing this. Bumped pin from v1.6.0 → v1.7.8 in both `publish.yml` and `publish-mcp-registry.yml`, with the matching SHA256 (`48230dbec85bd88a0d42977ef533cddda23235f0db4331b9263ce53b432cb75c`) verified from the upstream `registry_1.7.8_checksums.txt`. Future releases will sync to MCP Registry again.

## [0.2.5] - 2026-05-06

### Fixed

- **Setup-guide URL was 404.** Since v0.2.0, README + `docs/trackly-tools.md` linked users to `https://usetrackly.app/connect` for the visual co-work setup guide, but the page on TracklyWeb was published at `/connector` (singular). Anyone clicking the link from npm or GitHub hit a hard 404. Both references corrected to `/connector` (the canonical, live URL — already linked from `usetrackly.app/cli` and `usetrackly.app` footer).

## [0.2.4] - 2026-04-20

### Security

- **CI: all `uses:` actions pinned to commit SHA** across `auto-release.yml`, `ci.yml`, `docs-drift.yml`, `publish.yml`, `publish-mcp-registry.yml`. Previously `@v4` tags could be re-pointed upstream to a malicious commit without our repo seeing the change. `claude.yml` and `claude-code-review.yml` were already SHA-pinned.
- **CI: added `permissions: contents: read`** as the default for `ci.yml` and `docs-drift.yml`. Publish + auto-release workflows continue to opt into `contents: write` / `id-token: write` at the job level explicitly.
- **`@claude` workflows: added `github.actor` + `author_association` allowlist.** Previously any GitHub user could comment `@claude` on an issue/PR and trigger an agent run that holds AWS Bedrock credentials. Now gated on `kevinastuhuaman` OR `OWNER`/`MEMBER`/`COLLABORATOR` association. Same gate applied to `claude-code-review.yml` (fork PRs from unknown authors no longer auto-run Claude with production secrets).
- **HTTP client: 10 MB response-body cap** in `lib/client.js`. A malicious or misconfigured `TRACKLY_BASE_URL` can no longer stream unbounded data and OOM the long-lived MCP process. Destroyed-request errors are reported to the caller.
- **`/ask` response: `jobsUrl` path allowlist** (regex: `/^\/api\/(v1|jobscout)\/jobs(\?|$)/`). `normalizeEndpoint` already blocked cross-origin fetches, but a compromised backend could still emit a same-origin path like `/api/admin/secret-dump` that the CLI/MCP would fetch with the user's Authorization header. Both `bin/trackly:cmdAsk` and `mcp/server.js:trackly_ask` now refuse any `jobsUrl` outside the allowlist, and the MCP tool strips the refused URL from its return payload so the client doesn't receive it either.

## [0.2.3] - 2026-04-20

### Security

- **Supply chain: pinned `mcp-publisher` download + SHA256 verification in publish workflows.** Previously `.github/workflows/publish.yml` and `publish-mcp-registry.yml` piped `releases/latest` straight through `tar xz`, running any upstream-compromised binary inside a workflow that held OIDC + `NPM_TOKEN`. Now pinned to `v1.6.0` with SHA256 `2de4ac3b…405d42`.
- **Supply chain: npm publish now runs with `--provenance`.** README/CLAUDE.md claimed provenance attestations were active since 0.1.1, but `npm view trackly-cli@0.2.2 dist.attestations` was empty — docs shipped ahead of reality. The publish workflow now sets `--provenance` AND verifies the attestation landed on the registry (post-publish smoke), so a degraded provenance pipeline fails the release instead of silently shipping an unattested tarball.
- **Dependency CVEs: regenerated `package-lock.json` to pull `hono@4.12.14` + `@hono/node-server@1.19.14`.** Closes GHSA-92pp-h63x-v22m (middleware bypass via repeated slashes) and GHSA-26pp-8wgv-hjvm (cookie name validation). Both were moderate; neither was reachable at runtime because trackly-cli uses stdio MCP not HTTP, but `npm audit` now reports 0 vulnerabilities.
- **Token storage: atomic config write.** `saveConfig` now writes to `~/.trackly/config.json.tmp.<pid>` (mode 0600) and `fs.renameSync`s into place. A crash or SIGKILL mid-write no longer leaves a truncated config that silently loses auth.
- **Token storage: clear dead refresh tokens instead of retrying forever.** `refreshAccessToken` now calls `clearConfig()` on 400/401/403 from `/api/auth/refresh`, so an invalidated session doesn't trigger a doomed refresh attempt on every subsequent 401. Transient network errors (no `status`) still leave the token in place.
- **Secret hygiene: `--api-key` on command line now warns + scrubs argv.** The flag value is visible in `ps auxww` to local users and lands in shell history. The CLI now prints a one-line stderr warning (silenceable with `TRACKLY_NO_WARN=1`) and replaces the value in `process.argv` with `***` to defeat in-process leaks (e.g. an MCP tool accidentally logging `process.argv`). The `ps` vector itself is lost the moment the process starts — use `TRACKLY_API_KEY` env var or `trackly config --api-key` to avoid it entirely.

## [0.2.2] - 2026-04-20

### Fixed

- **CRITICAL: `trackly apply` / `save` / `dismiss` status updates returned HTTP 404.** Backend retired the old `/api/jobscout-tracker/status` endpoint in favor of `/api/jobscout/tracker/jobs/:id/stage` with stage mapping (`applied → applied`, `saved → backlog`, `dismissed → discarded`). CLI and local MCP now POST to the new endpoint with the correct stage value. On versions up to and including `0.2.1`, these commands hit the removed path and the backend returned a 404 HTML error — the tracker state was never updated server-side, even though the CLI exit code and (non-JSON) output did not make the failure obvious.
- **MCP sort enum drift** — `0.2.1` was published with the pre-PR-#17 code (Auto-Release only fires on version bumps; the sort fix merged but no bump triggered). This release actually ships `SORT_VALUES=['newest','match']` in the published tarball.

### Added

- `test/mcp-schema.test.js` regression test for the status-endpoint drift: asserts neither `bin/trackly` nor `mcp/server.js` contain a live `apiRequest('POST', ...)` to `/api/jobscout-tracker/status`, and both define the stage mapping.

## [0.2.1] - 2026-04-19

### Fixed

- **CLI query param mapping** — `cmdJobs` now correctly maps `--region` to `locationFilter`, `--job-type` to `jobModality` instead of the old `location`/`modality` that the backend ignored. Deprecated `--location` / `--modality` flags are explicitly rejected with migration hints (previously they silently passed through and were ignored).
- **CLI response fields** — `outputJobs` and `cmdJob` now read the real camelCase fields (`companyName`, `jobUrl`, `postedAt`, `firstSeenAt`, `description`, `totalJobCount`) instead of the snake_case names that never existed in production. `trackly job <id>` and `trackly jobs` now render all columns correctly instead of rendering blanks.
- **MCP `trackly_search_jobs` schema** — added missing `partnerships` to the function enum (14 canonical values now). `locationFilter` uses a 3-branch union matching the real backend parser (scalar specials, scalar region tag, array of region tags). `jobModality` values are `full_time | internship | all` (backend reality) instead of the old `remote | hybrid | onsite` (which the backend silently ignored). New explicit `remote` boolean param for the common remote-filter case. `status` values now match the real backend allowlist.
- **MCP schema `['us', 'europe']` leak** — the array branch of `locationFilter` no longer accepts `'us'` (which would cause the backend to silently drop the other entries). Zod rejects the invalid mix up front.
- **Docs** — `docs/trackly-tools.md` and `README.md` reflect the new flag surface; old examples claiming `--modality remote` are gone.

### Added

- New CLI flags: `--region <tag>`, `--job-type <full_time|internship|all>`, `--remote` boolean shorthand for `usStates=REMOTE`.
- `trackly jobs <id> --location us` now routes through cmdJobs so the deprecated-flag migration error fires (previously silently routed to cmdJob and dropped the filter).

## [0.1.10] - 2026-03-13

### Changed

- CI audit level upgraded from `moderate` to `high` (stops transitive false positives)
- Added Slack notification to #trackly-critical on CI failure
- Strict API key validation — rejects invalid keys immediately instead of warn-and-save
- Documented function enum mismatch gotcha in CLAUDE.md

## [0.1.9] - 2026-03-13

### Fixed

- README: `product_management` → `product` to match actual DB column values
- README: "7 MCP tools" → "10 MCP tools", added 3 missing tools to reference table
- CLI error message: "trackly applied" → "trackly apply"
- Added `--company` flag to CLI examples and docs/trackly-tools.md

## [0.1.8] - 2026-03-13

### Fixed

- **Critical:** jobFunction enum values in MCP now match DB (`product` not `product_management`) — filters were silently returning 0 results
- CLI parameter mapping: `function` → `jobFunction`, `keywords` → `search`
- Security: upgraded hono to fix prototype pollution (GHSA-v8w9-8mx6-g223)

### Added

- `--company` flag to CLI jobs command for company ID filtering

## [0.1.7] - 2026-03-12

### Added

- `companyId` filter on `trackly_search_jobs` MCP tool

### Fixed

- MCP `function` parameter now correctly maps to backend `jobFunction`
- MCP `keywords` parameter now correctly maps to backend `search`

## [0.1.6] - 2026-03-12

### Added

- `trackly contacts` — list/search contacts at companies
- `trackly brief` — get network brief for a job
- `trackly referral start/status` — start and check referral campaigns
- `trackly company-brief` (with `--refresh` flag) and `trackly company-workspace` commands
- `trackly_get_job_brief`, `trackly_contacts_at_company`, `trackly_get_company_workspace` MCP tools
- Funding series and valuation displayed in CLI job output

### Changed

- CLI onboarding improved: 3 auth options (OAuth, config, env var), login timeout 2→5 min, API key fallback on failure, retry up to 3 ports

## [0.1.5] - 2026-03-10

### Changed

- OAuth callback server hardened
- CSRF state parameter added to OAuth flow
- SSRF prevention on ask results
- Refresh token retry guard
- HTTPS enforcement for token refresh
- Zod validation for all MCP inputs

## [0.1.4] - 2026-03-08

### Added

- Implemented API key usage in the CLI via `--api-key`, `TRACKLY_API_KEY`, and `trackly config --api-key`
- Added `trackly config`, `trackly version`, `trackly status`, and `trackly companies search <query>` command support
- Added request timeout handling, manifest regression tests, CLI parser tests, and MCP startup smoke tests

### Changed

- MCP registry manifest now launches the package with the `mcp` subcommand and includes website metadata
- CLI and public docs now match the actual command surface and auth flows
- Authenticated requests now require HTTPS unless the target is localhost
- Browser login flow now opens URLs without shell interpolation

## [0.1.3] - 2026-03-07

### Changed
- Differentiated User-Agent headers: CLI sends `trackly-cli/0.1.3`, MCP sends `trackly-mcp/0.1.3`
- Enables server-side channel attribution for discovery metrics

## [0.1.2] - 2026-03-07

### Added

- Published to Official MCP Registry as `io.github.kevinastuhuaman/trackly`
- Added `mcpName` field to package.json for registry verification

## [0.1.1] - 2026-03-07

### Added

- SECURITY.md with vulnerability reporting policy and token storage documentation
- LICENSE file (MIT)
- CI/CD workflows for automated testing and npm publishing with provenance
- CHANGELOG.md following Keep a Changelog format
- FUNDING.yml for GitHub Sponsors

### Changed

- Enhanced npm package.json metadata (keywords, repository, homepage, funding)
- README rewritten with badges, feature comparison table, and GEO optimization
- MCP server input validation hardened with z.enum and limits

## [0.1.0] - 2026-03-07

### Added

- Initial release
- 14 CLI commands for job application tracking
- 7 MCP tools for AI assistant integration
- Google OAuth login flow
- API key management
- Natural language job search
