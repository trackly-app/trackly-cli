'use strict';

// Trackly Apply (cloud) MCP tools: trackly_auto_apply and trackly_auto_apply_status, mirrored
// from the hosted MCP (close-ai #3536, src/mcp/auto-apply.ts and src/mcp/server.ts). createServer
// registers both directly, so the release-time hosted-contract check sees them statically and at
// runtime. Same names, arguments and request bodies as the hosted tools.

const { z } = require('zod');
const {
  AUTO_APPLY_TITLE,
  AUTO_APPLY_STATUS_TITLE,
  MAX_JOB_ID,
  MAX_STATUS_JOB_IDS,
  listAutoApplyRequests,
  requestAutoApply,
} = require('../lib/auto-apply');

const autoApplyInputSchema = z.object({
  jobId: z.number().int().positive().max(MAX_JOB_ID)
    .describe('Numeric Trackly job ID from trackly_search_jobs. Employer requisition IDs and URLs are not Trackly job IDs.'),
}).strict();

const autoApplyStatusInputSchema = z.object({
  jobIds: z.array(z.number().int().positive().max(MAX_JOB_ID)).min(1).max(MAX_STATUS_JOB_IDS).optional()
    .describe('Trackly job IDs to look up. Omitted lists the most recent requests.'),
}).strict();

// Closed-world like the hosted plugin tools: the call reaches only Trackly's API, which queues the
// request; the employer submission happens later, outside the call. Destructive because it leads
// to a real application.
const AUTO_APPLY_ANNOTATIONS = Object.freeze({
  title: AUTO_APPLY_TITLE,
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
});

const AUTO_APPLY_STATUS_ANNOTATIONS = Object.freeze({
  title: AUTO_APPLY_STATUS_TITLE,
  readOnlyHint: true,
  openWorldHint: false,
});

/** Handlers bound to the MCP's authenticated API client. */
function createCloudAutoApplyHandlers(api) {
  return {
    autoApply: ({ jobId }) => requestAutoApply(api, jobId),
    autoApplyStatus: ({ jobIds }) => listAutoApplyRequests(api, jobIds),
  };
}

module.exports = {
  AUTO_APPLY_ANNOTATIONS,
  AUTO_APPLY_STATUS_ANNOTATIONS,
  autoApplyInputSchema,
  autoApplyStatusInputSchema,
  createCloudAutoApplyHandlers,
};
