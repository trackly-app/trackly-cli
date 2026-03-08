'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { apiRequest, getToken } = require('../lib/client');

const MCP_USER_AGENT = 'trackly-mcp/0.1.3';

const server = new McpServer({
  name: 'trackly',
  version: '0.1.3',
});

// Tool: Search/filter jobs
server.tool(
  'trackly_search_jobs',
  'Search and filter job postings. Returns matching jobs with title, company, location, modality.',
  {
    function: z.enum(['product_management','engineering','design','data_science','marketing','sales','finance','operations','legal','hr','other']).optional().describe('Job function filter: product_management, engineering, design, data_science, marketing, sales, finance, operations, legal, hr, other'),
    location: z.string().optional().describe('Location filter (city or state)'),
    modality: z.enum(['remote','hybrid','onsite']).optional().describe('Work modality: remote, hybrid, onsite'),
    status: z.enum(['new','saved','applied','dismissed']).optional().describe('Application status: new, saved, applied, dismissed'),
    sort: z.enum(['newest','oldest','company']).optional().describe('Sort order: newest, oldest, company'),
    limit: z.number().max(50).optional().describe('Max results (default 20, max 50)'),
    offset: z.number().min(0).optional().describe('Pagination offset'),
    keywords: z.string().max(500).optional().describe('Keyword search in title/description'),
  },
  async (params) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    try {
      const result = await apiRequest('GET', `/api/jobscout/jobs?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: Get job detail
server.tool(
  'trackly_get_job',
  'Get full details for a specific job posting including description.',
  {
    id: z.number().describe('Job posting ID'),
  },
  async ({ id }) => {
    try {
      const result = await apiRequest('GET', `/api/jobscout/jobs/${id}`, null, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: Search companies
server.tool(
  'trackly_search_companies',
  'Semantic search for companies by name, domain, or keywords.',
  {
    query: z.string().max(500).describe('Search query'),
    limit: z.number().max(50).optional().describe('Max results (default 10)'),
  },
  async ({ query, limit }) => {
    const qs = new URLSearchParams({ q: query });
    if (limit) qs.set('limit', String(limit));
    try {
      const result = await apiRequest('GET', `/api/jobscout/companies/search?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: List companies
server.tool(
  'trackly_list_companies',
  'List all tracked companies with their active job counts.',
  {
    limit: z.number().max(50).optional().describe('Max results'),
    offset: z.number().min(0).optional().describe('Pagination offset'),
  },
  async ({ limit, offset }) => {
    const qs = new URLSearchParams();
    if (limit) qs.set('limit', String(limit));
    if (offset) qs.set('offset', String(offset));
    try {
      const result = await apiRequest('GET', `/api/jobscout/companies?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: Get stats
server.tool(
  'trackly_get_stats',
  'Get job tracker metrics: total jobs, companies, application status counts.',
  {},
  async () => {
    try {
      const result = await apiRequest('GET', '/api/jobscout/me', null, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: Update job status
server.tool(
  'trackly_update_status',
  'Update a job application status (apply, save, or dismiss).',
  {
    id: z.number().describe('Job posting ID'),
    action: z.enum(['applied', 'saved', 'dismissed']).describe('Status action'),
  },
  async ({ id, action }) => {
    try {
      const result = await apiRequest('POST', '/api/jobscout-tracker/status', { jobId: id, action }, false, false, MCP_USER_AGENT);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Tool: Natural language search
server.tool(
  'trackly_ask',
  'Natural language job search. Describe what you are looking for and the AI parses it into structured filters. Limited to 20 queries per day.',
  {
    query: z.string().max(500).describe('Natural language search query, e.g. "PM jobs at fintech companies in SF"'),
  },
  async ({ query }) => {
    try {
      const askResult = await apiRequest('GET', `/api/jobscout/ask?q=${encodeURIComponent(query)}`, null, false, false, MCP_USER_AGENT);
      // Auto-fetch jobs with parsed filters
      if (askResult.jobsUrl && askResult.jobsUrl.startsWith('/api/')) {
        const jobsResult = await apiRequest('GET', askResult.jobsUrl, null, false, false, MCP_USER_AGENT);
        return { content: [{ type: 'text', text: JSON.stringify({ ...askResult, jobs: jobsResult.jobs || jobsResult.data || [] }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(askResult, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: e.error || e.message }) }], isError: true };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error('MCP server error:', e);
  process.exit(1);
});
