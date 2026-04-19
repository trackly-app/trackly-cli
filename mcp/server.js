'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { apiRequest, hasAuth } = require('../lib/client');
const { version: PACKAGE_VERSION } = require('../package.json');

const MCP_USER_AGENT = `trackly-mcp/${PACKAGE_VERSION}`;
const AUTH_HINT = 'Run `trackly login` or set TRACKLY_API_KEY. Get a key at https://usetrackly.app (sign in → Settings → API Keys).';

// Mirrors `granola-followup-app/src/services/region-classifier.ts:8` REGION_TAGS.
// Keep in sync when the backend enum changes.
const REGION_TAGS = [
  'us', 'europe', 'latam', 'middle_east', 'asia', 'africa', 'canada', 'oceania', 'remote', 'unknown',
];

// `jobFunction` enum matches `granola-followup-app/src/routes/jobscout-filter-utils.ts:17-21`
// (ALL_JOB_FUNCTIONS). 14 canonical values.
const JOB_FUNCTIONS = [
  'product', 'engineering', 'design', 'data', 'marketing', 'sales', 'partnerships',
  'finance', 'strategy', 'operations', 'people', 'legal', 'support', 'other',
];

// `status` enum matches the backend allowlist at `jobscout.ts:2949`.
const STATUS_VALUES = ['new', 'applying', 'applied_confirmed', 'check_later', 'not_interested', 'all'];

// `jobModality` enum matches `jobscout.ts:2870-2875`. Employment type, NOT work-location.
const JOB_MODALITIES = ['full_time', 'internship', 'all'];

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
    'Search and filter job postings. Returns matching jobs with title, company, location, and structured fields. Use companyId to filter jobs at a specific company (get companyId from trackly_search_companies first). Use --remote=true for remote jobs.',
    {
      function: z.enum(JOB_FUNCTIONS).optional().describe('Job function filter. One of: ' + JOB_FUNCTIONS.join(', ')),
      companyId: z.number().optional().describe('Filter jobs by company ID (get from trackly_search_companies)'),
      locationFilter: z.union([
        z.enum(['us', 'non_us', 'all']),
        z.enum(REGION_TAGS),
        z.array(z.enum(REGION_TAGS)).min(1),
      ]).optional().describe(
        "Region tag filter. Use a single value (us, non_us, all, or a REGION_TAGS value like 'europe', 'remote') OR an array of REGION_TAGS values for multi-region (e.g. ['europe', 'canada']). us/non_us/all CANNOT be combined in an array — the backend silently drops them. For 'not us' use non_us alone."
      ),
      jobModality: z.enum(JOB_MODALITIES).optional().describe(
        'Employment type (NOT work-location style). full_time = full-time roles, internship = internships, all = both. For remote/hybrid/onsite filtering, use the `remote` boolean or locationFilter="remote".'
      ),
      remote: z.boolean().optional().describe('Filter to remote jobs only (maps to usStates=REMOTE).'),
      status: z.enum(STATUS_VALUES).optional().describe(
        'Filter by YOUR application pipeline state. Not a generic job-posting status. Values: ' + STATUS_VALUES.join(', ')
      ),
      sort: z.enum(['newest', 'oldest', 'company']).optional().describe('Sort order: newest, oldest, company'),
      limit: z.number().max(50).optional().describe('Max results (default 20, max 50)'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
      keywords: z.string().max(500).optional().describe('Keyword search in title, company, or description'),
    },
    wrapTool(async (params) => {
      const qs = new URLSearchParams();
      if (params.function !== undefined) qs.set('jobFunction', params.function);
      if (params.companyId !== undefined) qs.set('companyId', String(params.companyId));
      if (params.locationFilter !== undefined) {
        const value = Array.isArray(params.locationFilter)
          ? params.locationFilter.join(',')
          : params.locationFilter;
        qs.set('locationFilter', value);
      }
      if (params.jobModality !== undefined) qs.set('jobModality', params.jobModality);
      if (params.remote === true) qs.set('usStates', 'REMOTE');
      if (params.status !== undefined) qs.set('status', params.status);
      if (params.sort !== undefined) qs.set('sort', params.sort);
      if (params.limit !== undefined) qs.set('limit', String(params.limit));
      if (params.offset !== undefined) qs.set('offset', String(params.offset));
      if (params.keywords !== undefined) qs.set('search', params.keywords);
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

  server.tool(
    'trackly_get_job_brief',
    'Get a network brief for a specific job. Returns company signal, recommended motion, top contact, and suggested actions.',
    {
      jobId: z.number().describe('Job posting ID'),
    },
    wrapTool(async ({ jobId }) => {
      return apiRequest('GET', `/api/jobscout/jobs/${jobId}/network-brief`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to fetch network brief')
  );

  server.tool(
    'trackly_contacts_at_company',
    'Search contacts at a specific company. Returns matching contacts with name, title, email, and status.',
    {
      company: z.string().max(200).describe('Company name to search contacts for'),
      limit: z.number().max(50).optional().describe('Max results (default 20)'),
    },
    wrapTool(async ({ company, limit }) => {
      const qs = new URLSearchParams({ search: company });
      if (limit) qs.set('limit', String(limit));
      return apiRequest('GET', `/api/network/people?${qs.toString()}`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to search contacts at company')
  );

  server.tool(
    'trackly_get_company_workspace',
    'Get the full workspace view for a company: active jobs, contacts, hiring managers, coverage gap, and campaign status.',
    {
      companyId: z.number().describe('Company ID'),
    },
    wrapTool(async ({ companyId }) => {
      return apiRequest('GET', `/api/network/companies/${companyId}/workspace`, null, false, false, MCP_USER_AGENT);
    }, 'Failed to fetch company workspace')
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
