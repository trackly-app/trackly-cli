'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { apiRequest, hasAuth } = require('../lib/client');
const { version: PACKAGE_VERSION } = require('../package.json');

const MCP_USER_AGENT = `trackly-mcp/${PACKAGE_VERSION}`;
const AUTH_HINT = 'Run `trackly login` or configure an API key with `trackly config --api-key <key>`.';

function createErrorResult(error, fallbackMessage, extra = {}) {
  const payload = {
    error: error?.error || error?.message || fallbackMessage,
    ...extra,
  };

  if (error?.status) {
    payload.status = error.status;
  }

  if (error?.status === 429 && !payload.hint) {
    payload.hint = 'Daily limit reached (20 natural language queries per day).';
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

function createAuthErrorResult() {
  return createErrorResult(
    { message: 'Not authenticated', status: 401 },
    'Not authenticated',
    { hint: AUTH_HINT }
  );
}

function wrapTool(handler, fallbackMessage) {
  return async (params) => {
    try {
      if (!hasAuth()) {
        return createAuthErrorResult();
      }

      const result = await handler(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return createErrorResult(
        error,
        fallbackMessage,
        error?.status === 401 ? { hint: AUTH_HINT } : {}
      );
    }
  };
}

function createServer() {
  const server = new McpServer({
    name: 'trackly',
    version: PACKAGE_VERSION,
  });

  server.tool(
    'trackly_search_jobs',
    'Search and filter job postings. Returns matching jobs with title, company, location, modality.',
    {
      function: z.enum(['product_management', 'engineering', 'design', 'data_science', 'marketing', 'sales', 'finance', 'operations', 'legal', 'hr', 'other']).optional().describe('Job function filter: product_management, engineering, design, data_science, marketing, sales, finance, operations, legal, hr, other'),
      location: z.string().optional().describe('Location filter (city or state)'),
      modality: z.enum(['remote', 'hybrid', 'onsite']).optional().describe('Work modality: remote, hybrid, onsite'),
      status: z.enum(['new', 'saved', 'applied', 'dismissed']).optional().describe('Application status: new, saved, applied, dismissed'),
      sort: z.enum(['newest', 'oldest', 'company']).optional().describe('Sort order: newest, oldest, company'),
      limit: z.number().max(50).optional().describe('Max results (default 20, max 50)'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
      keywords: z.string().max(500).optional().describe('Keyword search in title/description'),
    },
    wrapTool(async (params) => {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) qs.set(key, String(value));
      }
      return apiRequest('GET', `/api/jobscout/jobs?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to search jobs')
  );

  server.tool(
    'trackly_get_job',
    'Get full details for a specific job posting including description.',
    {
      id: z.number().describe('Job posting ID'),
    },
    wrapTool(async ({ id }) => {
      return apiRequest('GET', `/api/jobscout/jobs/${id}`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to fetch job')
  );

  server.tool(
    'trackly_search_companies',
    'Semantic search for companies by name, domain, or keywords.',
    {
      query: z.string().max(500).describe('Search query'),
      limit: z.number().max(50).optional().describe('Max results (default 10)'),
    },
    wrapTool(async ({ query, limit }) => {
      const qs = new URLSearchParams({ q: query });
      if (limit) qs.set('limit', String(limit));
      return apiRequest('GET', `/api/jobscout/companies/search?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to search companies')
  );

  server.tool(
    'trackly_list_companies',
    'List all tracked companies with their active job counts.',
    {
      limit: z.number().max(50).optional().describe('Max results'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
    },
    wrapTool(async ({ limit, offset }) => {
      const qs = new URLSearchParams();
      if (limit) qs.set('limit', String(limit));
      if (offset !== undefined) qs.set('offset', String(offset));
      return apiRequest('GET', `/api/jobscout/companies?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to list companies')
  );

  server.tool(
    'trackly_get_stats',
    'Get job tracker metrics: total jobs, companies, application status counts.',
    {},
    wrapTool(async () => {
      return apiRequest('GET', '/api/jobscout/me', null, false, false, MCP_USER_AGENT);
    }, 'Failed to fetch stats')
  );

  server.tool(
    'trackly_update_status',
    'Update a job application status (apply, save, or dismiss).',
    {
      id: z.number().describe('Job posting ID'),
      action: z.enum(['applied', 'saved', 'dismissed']).describe('Status action'),
    },
    wrapTool(async ({ id, action }) => {
      return apiRequest('POST', '/api/jobscout-tracker/status', { jobId: id, action }, false, false, MCP_USER_AGENT);
    }, 'Failed to update job status')
  );

  server.tool(
    'trackly_ask',
    'Natural language job search. Describe what you are looking for and the AI parses it into structured filters. Limited to 20 queries per day.',
    {
      query: z.string().max(500).describe('Natural language search query, e.g. "PM jobs at fintech companies in SF"'),
    },
    wrapTool(async ({ query }) => {
      const askResult = await apiRequest('GET', `/api/jobscout/ask?q=${encodeURIComponent(query)}`, null, false, false, MCP_USER_AGENT);
      if (askResult.jobsUrl) {
        const jobsResult = await apiRequest('GET', askResult.jobsUrl, null, false, false, MCP_USER_AGENT);
        return {
          ...askResult,
          jobs: jobsResult.jobs || jobsResult.data || [],
        };
      }
      return askResult;
    }, 'Failed to process natural language query')
  );

  return server;
}

async function startMcpServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

if (require.main === module) {
  startMcpServer().catch((error) => {
    console.error('MCP server error:', error);
    process.exit(1);
  });
}

module.exports = {
  AUTH_HINT,
  createAuthErrorResult,
  createErrorResult,
  createServer,
  startMcpServer,
};
