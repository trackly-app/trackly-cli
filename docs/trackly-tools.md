## Trackly Job Tracker (MCP)

Trackly MCP server provides job search and tracking tools. Two ways to connect:

### Claude co-work, Claude Desktop, ChatGPT (hosted, no install)

In your AI tool, open **Settings → Connectors → Add custom connector**:

- URL: `https://mcp.usetrackly.app/api/mcp`
- Leave any optional OAuth fields empty — **Client ID**, **Client Secret**, **Authorization URL**, **Token URL** — Trackly uses OAuth 2.1 Dynamic Client Registration and will register the client automatically
- If the client UI uses different labels or requires you to continue past an OAuth section, keep those fields blank and proceed to sign in. Do not invent client credentials or endpoint URLs.

Sign in with Google when prompted. [Visual guide →](https://usetrackly.app/connector)

### Cursor, Windsurf, Claude Code (CLI via stdio)

Install and start the stdio server:

```bash
npm install -g trackly-cli
trackly mcp
```

#### Claude Code

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

#### Cursor / Windsurf

Add to `.cursor/mcp.json` (same schema for Windsurf):

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

- **trackly_search_jobs** — Search/filter jobs.
  - `function` (14 values): `product`, `engineering`, `design`, `data`, `marketing`, `sales`, `partnerships`, `finance`, `strategy`, `operations`, `people`, `legal`, `support`, `other`
  - `locationFilter`: pass ONE of
    - a single scalar: `us`, `non_us`, `all`, or a region tag (`europe`, `latam`, `middle_east`, `asia`, `africa`, `canada`, `oceania`, `remote`, `unknown`), OR
    - an array of region tags for multi-region (e.g. `["europe", "canada"]`). The array form excludes `us` — combining `us` with other tags in an array causes the backend to silently drop the others. To get "not US" use the scalar `non_us` alone.
  - `jobModality`: `full_time`, `internship`, `all` — employment type, NOT work-location style. For remote filtering, use the `remote` boolean or `locationFilter: "remote"`. Hybrid and onsite are not exposed as filters.
  - `remote` (boolean): filter to remote jobs only. Maps to `usStates=REMOTE`.
  - `status`: your application pipeline state. Values: `new`, `applying`, `applied_confirmed`, `check_later`, `not_interested`, `all`.
  - `sort`: `newest` (default) or `match` (highest match score first; requires a resume on file). Backend rejects the deprecated values `oldest` and `company` with HTTP 400.
  - `keywords`, `companyId`, `limit`, `offset`.
- **trackly_get_job** — Get full job details by ID
- **trackly_search_companies** — Semantic company search
- **trackly_list_companies** — List all tracked companies with job counts
- **trackly_get_stats** — Job tracker metrics dashboard
- **trackly_update_status** — Mark a job as applied, saved, or dismissed
- **trackly_ask** — Natural language job search (20/day limit)
- **trackly_get_job_brief** — Get network brief for a job (company signal, top contact, actions)
- **trackly_contacts_at_company** — Search contacts at a specific company
- **trackly_get_company_workspace** — Get full company workspace (jobs, contacts, hiring managers, campaigns)
- **trackly_request_company** — Request that a company be added to Trackly's tracked companies. Rate-limited to 5 pending requests per user. Parameters: `companyName` (required), `companyUrl` (optional), `notes` (optional).

> **Why no `trackly_chat` here (intentional, not drift):** the hosted connector (`mcp.usetrackly.app`) exposes a 12th tool, `trackly_chat`, that runs a backend agent which orchestrates these same primitives. It exists so **classic-UI** surfaces (web/iOS/macOS) — which have no agent — get an agentic chat experience. The CLI/MCP client **is** the agent (Claude, Cursor, ChatGPT), so calling `trackly_chat` would be an agent-inside-an-agent: opaque, slower, and double-cost. MCP users already have `trackly_ask` (natural-language search) and `trackly_search_jobs sort=match` (resume-fit ranking), and `trackly_get_stats` returns the user's structured job preferences — full capability coverage. So `trackly_chat` is deliberately hosted-only.

### Example Prompts

- "Find me PM jobs at fintech companies"
- "What remote engineering roles are available?"
- "Show me jobs at Stripe"
- "Mark job 1234 as applied"
