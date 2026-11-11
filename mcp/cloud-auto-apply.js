'use strict';

// Cloud auto-apply MCP tool, held out of published releases until the hosted MCP ships
// trackly_auto_apply (close-ai #3536). createServer does not call this, so the local tool list
// matches the hosted catalog and the release-time hosted-contract check passes honestly.
// Releasing it: call registerCloudAutoApplyTool(server, { wrapTool, mcpUserAgent:
// MCP_USER_AGENT }) from createServer as a direct statement, set lib/auto-apply.js
// cloudAutoApply.released, and recapture the hosted contract. See lib/auto-apply.js.

const { z } = require('zod');
const { apiRequest } = require('../lib/client');
const { validateAssistResponse, autoApplyUnavailableError, autoApplyRequestError } = require('../lib/auto-apply');

function registerCloudAutoApplyTool(server, { wrapTool, mcpUserAgent }) {
  server.registerTool(
    'trackly_auto_apply',
    {
      description: 'Request cloud auto-apply for one Trackly job at a US Greenhouse, Lever, or Ashby posting using the account default resume. Trackly submits the application asynchronously and notifies the user. Call only when the user asks Trackly to apply to this job. Check the server autoApplySupported field when present. Returns the request and its current status; check progress with trackly apply --status in the CLI.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        jobId: z.number().int().positive().max(2147483647).describe('Trackly job ID to apply to'),
      }).strict(),
    },
    wrapTool(async ({ jobId }) => {
      try {
        // `acknowledged: true`: requesting auto-apply is the user's consent for Trackly staff to use
        // every profile answer, sensitive ones included, to complete the application (Kevin, 2026-11-10).
        const result = await apiRequest('POST', '/api/jobscout/apply/assist-requests', {
          jobId, acknowledged: true,
        }, false, false, mcpUserAgent);
        validateAssistResponse(result, { jobId });
        return { ...result, message: 'Trackly will apply and notify you.' };
      } catch (error) {
        if (error?.status === 404) {
          throw autoApplyUnavailableError(error);
        }
        throw autoApplyRequestError(error);
      }
    }, 'Failed to request auto-apply'),
  );
}

module.exports = { registerCloudAutoApplyTool };
