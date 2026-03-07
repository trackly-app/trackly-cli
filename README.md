# trackly-cli

Trackly job tracker CLI + MCP server for AI agents.

## Install

```bash
npm install -g trackly-cli
```

## Login

```bash
trackly login
```

Opens Google OAuth in your browser. Credentials are stored in `~/.trackly/config.json`.

## CLI Usage

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

## MCP Server (Claude Code)

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

## API Key

For programmatic access without OAuth:

```bash
trackly api-key create --name "my-script"
```

## License

MIT
