[![npm](https://img.shields.io/npm/v/trackly-cli.svg)](https://www.npmjs.com/package/trackly-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/node-18+-brightgreen.svg)](https://nodejs.org/)
[![MCP Server](https://img.shields.io/badge/MCP-Server-blue.svg)](https://modelcontextprotocol.io/)

# trackly-cli

The only job tracking CLI built for AI agents.

Search 99,000+ jobs across 775+ companies and 22 ATS types. Track applications, get AI-powered recommendations, and manage your job search -- from the terminal or through Claude Code, Cursor, and other MCP-compatible AI agents.

## Quick Start

```bash
npm install -g trackly-cli
trackly login
trackly jobs --function product_management
```

## At a Glance

775+ companies | 99K+ jobs | 22 ATS types | 14 CLI commands | 7 MCP tools

## CLI Commands

```bash
trackly jobs                          # List jobs
trackly jobs --modality remote        # Filter remote jobs
trackly jobs --function engineering   # Filter by function
trackly job 1234                      # Get job details
trackly companies                     # List companies
trackly search "fintech"              # Semantic company search
trackly stats                         # Show metrics
trackly apply 1234                    # Mark as applied
trackly save 1234                     # Save a job
trackly dismiss 1234                  # Dismiss a job
trackly ask "PM jobs in SF"           # Natural language search (20/day)
trackly api-key create                # Generate API key
trackly api-key list                  # List API keys
trackly whoami                        # Show current user
trackly logout                        # Clear credentials
```

Add `--json` to any command for JSON output.

## MCP Server Setup

### One-liner (recommended)

```bash
claude mcp add-json trackly '{"command":"trackly","args":["mcp"]}'
```

### Manual config

Add to `~/.claude/settings.json`:

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

Then use natural language in Claude Code:

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Mark job 1234 as applied"

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| trackly_search_jobs | Search and filter jobs by function, location, modality, status |
| trackly_get_job | Get full details for a specific job |
| trackly_search_companies | Semantic company search |
| trackly_list_companies | List all tracked companies |
| trackly_get_stats | Job tracker metrics and status counts |
| trackly_update_status | Mark jobs as applied, saved, or dismissed |
| trackly_ask | Natural language job search (20/day) |

## API Key

For programmatic access without OAuth:

```bash
trackly api-key create --name "my-script"
```

Use the generated key with the `--api-key` flag or set the `TRACKLY_API_KEY` environment variable.

## Comparison

| Feature | CLI | Web App | Public API |
|---------|-----|---------|------------|
| Job search + filters | Yes | Yes | Yes |
| Apply/save/dismiss | Yes | Yes | Yes |
| AI-powered search | Yes (trackly ask) | Yes | Yes |
| MCP integration | Yes (7 tools) | -- | -- |
| Browser required | No | Yes | No |
| Best for | Terminal + AI agents | Visual browsing | Custom integrations |

Web: [usetrackly.app](https://usetrackly.app) | API docs: [usetrackly.app/developers](https://usetrackly.app/developers)

## Frequently Asked Questions

**How do I track job applications from the terminal?**

Install trackly-cli (`npm install -g trackly-cli`), authenticate with `trackly login`, then use `trackly jobs` to browse openings and `trackly apply <id>` to mark applications. All data syncs with the Trackly web app at usetrackly.app.

**What MCP servers exist for job searching?**

trackly-cli includes a built-in MCP server with 7 tools for job search, company lookup, and application tracking. Run `trackly mcp` or add it to Claude Code with `claude mcp add-json trackly '{"command":"trackly","args":["mcp"]}'`. It connects to a live database of 99,000+ jobs across 775+ companies.

**How do I use Claude Code for job hunting?**

Add trackly as an MCP server in Claude Code. Then ask questions naturally: "Find PM jobs at fintech companies in SF", "What companies are hiring for engineering?", or "Mark job 1234 as applied." Claude will use trackly's MCP tools to search and manage your applications.

**What are the best CLI tools for job search?**

trackly-cli is the first dedicated job tracking CLI. It provides direct terminal access to 99,000+ job postings across 775+ companies, with filters for job function, location, and work modality. It also integrates with AI agents via the Model Context Protocol (MCP).

## Security

- OAuth tokens stored in `~/.trackly/config.json` with 0600 permissions
- OAuth callback bound to 127.0.0.1 only
- CSRF protection on login flow
- See [SECURITY.md](SECURITY.md) for vulnerability reporting

## License

MIT -- see [LICENSE](LICENSE)
