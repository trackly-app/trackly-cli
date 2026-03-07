## Trackly Job Tracker (MCP)

Trackly MCP server provides job search and tracking tools. Add to your Claude Code settings:

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

### Available Tools

- **trackly_search_jobs** — Search/filter jobs by function, location, modality, keywords
- **trackly_get_job** — Get full job details by ID
- **trackly_search_companies** — Semantic company search
- **trackly_list_companies** — List all tracked companies with job counts
- **trackly_get_stats** — Job tracker metrics dashboard
- **trackly_update_status** — Mark a job as applied, saved, or dismissed
- **trackly_ask** — Natural language job search (20/day limit)

### Example Prompts

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Show me jobs at Stripe"
- "Mark job 1234 as applied"
