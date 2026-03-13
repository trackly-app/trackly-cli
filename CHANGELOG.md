# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
