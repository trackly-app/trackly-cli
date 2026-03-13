## Trackly Job Tracker (MCP)

Trackly MCP server provides job search and tracking tools. Start it with:

```bash
trackly mcp
```

### Claude Code

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

### Cursor

Add to `.cursor/mcp.json`:

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

### Authentication

Use either interactive OAuth:

```bash
trackly login
```

Or an API key:

```bash
trackly config --api-key trk_xxxxxxxxxxxxxxxxxxxx
```

You can also pass `TRACKLY_API_KEY` as an environment variable for one-off runs.

### Available Tools

- **trackly_search_jobs** — Search/filter jobs by function, company, location, modality, keywords. Function values: `product`, `engineering`, `design`, `data`, `marketing`, `sales`, `finance`, `operations`, `legal`, `people`, `strategy`, `support`, `other`
- **trackly_get_job** — Get full job details by ID
- **trackly_search_companies** — Semantic company search
- **trackly_list_companies** — List all tracked companies with job counts
- **trackly_get_stats** — Job tracker metrics dashboard
- **trackly_update_status** — Mark a job as applied, saved, or dismissed
- **trackly_ask** — Natural language job search (20/day limit)
- **trackly_get_job_brief** — Get network brief for a job (company signal, top contact, actions)
- **trackly_contacts_at_company** — Search contacts at a specific company
- **trackly_get_company_workspace** — Get full company workspace (jobs, contacts, hiring managers, campaigns)

### Example Prompts

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Show me jobs at Stripe"
- "Mark job 1234 as applied"
