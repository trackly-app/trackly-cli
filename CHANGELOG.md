# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
