'use strict';

// Trackly Apply (cloud): the user only requests it and Trackly applies to the employer for them;
// nothing runs on the user's computer. It is not Trackly Apply (local), where the user's own AI
// agent fills the application in the user's browser and the user submits, and not mark applied,
// which records an application the user made themselves (Kevin, 2026-11-10).
//
// The descriptions, the search flag and the request views mirror close-ai src/mcp/auto-apply.ts
// (close-ai #3536, deployed in 96781f59) so the npm and hosted MCP tools stay in step. The
// backend routes (POST/GET /api/jobscout/apply/assist-requests) decide the account cohort, the
// posting scope and the plan allowance.

const MAX_JOB_ID = 2147483647;
const MAX_STATUS_JOB_IDS = 200;
const MAX_STATUS_REQUESTS = 50;

const CLI_STATUS_HINT = 'Check your request status with trackly auto-apply --status before requesting again.';
const MCP_STATUS_HINT = 'Check whether the request exists with trackly_auto_apply_status before requesting again.';

const AUTO_APPLY_TITLE = 'Trackly Apply (cloud): apply to a job';
const AUTO_APPLY_STATUS_TITLE = 'Get Trackly Apply (cloud) requests';

// Mirrors the hosted AUTO_APPLY_DESCRIPTION. Functional only: no prices, plans or promotion.
const AUTO_APPLY_DESCRIPTION = 'Requests Trackly Apply (cloud) for one Trackly job: Trackly applies to the '
  + 'employer for the user with the account\'s default resume and every saved application profile answer, '
  + 'sensitive ones included, then notifies the user. Nothing runs on the user\'s computer. This differs from '
  + 'Trackly Apply (local), where the user\'s own AI agent fills the application in the user\'s browser and stops '
  + 'before Submit for the user to submit; that uses the Trackly Apply (local) tools and the Trackly Apply skill, '
  + 'not this one. It also differs from trackly_update_status with action=applied, which only records an '
  + 'application the user made themselves. Supported for US postings on Greenhouse, Lever and Ashby job boards; '
  + 'search results mark them with autoApplySupported. Calling this tool is the user\'s instruction to apply, so '
  + 'it is for a job the user has explicitly asked Trackly to apply to, never a suggestion. Each request counts '
  + 'toward the account\'s Trackly Apply (cloud) allowance. Returns the request with its status; '
  + 'trackly_auto_apply_status reports progress later. It does not fill a browser form.';

const AUTO_APPLY_STATUS_DESCRIPTION = 'Lists the user\'s Trackly Apply (cloud) requests with their status '
  + '(queued, claimed, submitted, failed or cancelled), newest first, optionally for specific Trackly job IDs. '
  + 'Read-only.';

// Appended to the trackly_search_jobs description, as on the hosted MCP.
const AUTO_APPLY_SEARCH_FIELD_DESCRIPTION = 'Each job has autoApplySupported: true when trackly_auto_apply '
  + 'can request Trackly Apply (cloud) for it (an active US Greenhouse, Lever or Ashby posting). It does not decide '
  + 'Trackly Apply (local) eligibility.';

const AUTO_APPLY_QUEUED_MESSAGE = 'Trackly will submit this application and notify you when it is done. '
  + 'trackly_auto_apply_status or the Trackly web app shows its status.';

// The enqueue's own posting scope lock (close-ai assistPostingTarget).
const ASSIST_POSTING_HOSTS = Object.freeze({
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
});

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function assistPostingTarget(postingUrl) {
  let url;
  try {
    url = new URL(postingUrl ?? '');
  } catch {
    return null;
  }
  const ats = url.protocol === 'https:' && Object.hasOwn(ASSIST_POSTING_HOSTS, url.host)
    ? ASSIST_POSTING_HOSTS[url.host]
    : undefined;
  return ats ? { host: url.host, ats } : null;
}

/**
 * Whether POST /assist-requests can accept this job: a live posting whose stored is_us decision is
 * true and whose host passes the enqueue's scope lock. Unknown or older payloads fail closed.
 */
function jobAutoApplySupported(job) {
  const value = record(job);
  if (!value) return false;
  if (value.isActive === false) return false;
  if (value.isUs !== true) return false;
  return assistPostingTarget(typeof value.jobUrl === 'string' ? value.jobUrl : null) !== null;
}

const NON_ACTIONABLE_STATUSES = new Set(['applied', 'applied_confirmed', 'not_interested', 'discarded', 'dismissed']);

function autoApplyNextSteps(count) {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return `Trackly Apply (cloud) can apply to up to ${count} of these jobs for you.`;
}

/**
 * Sets autoApplySupported on every job of a /api/jobscout/jobs page (the REST mapper keeps its
 * retired constant false) and, for the MCP, adds a factual nextSteps line when at least one job the
 * user has not applied to or dismissed is supported. Never mutates the backend object.
 */
function withAutoApplySupport(response, { nextSteps: includeNextSteps = true } = {}) {
  const page = record(response);
  if (!page || !Array.isArray(page.jobs)) return response;
  let actionable = 0;
  const jobs = page.jobs.map((job) => {
    const value = record(job);
    if (!value) return job;
    const autoApplySupported = jobAutoApplySupported(value);
    if (autoApplySupported && !NON_ACTIONABLE_STATUSES.has(String(value.userStatus))) actionable += 1;
    return { ...value, autoApplySupported };
  });
  const { nextSteps: _previous, ...rest } = page;
  const nextSteps = includeNextSteps ? autoApplyNextSteps(actionable) : null;
  return { ...rest, jobs, ...(nextSteps ? { nextSteps } : {}) };
}

/** Keep server diagnostics bounded and free of terminal control characters. */
function safeDiagnostic(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 500) : null;
}

function validRequest(request, jobId) {
  return Boolean(request
    && typeof request.id === 'string' && request.id.trim()
    && typeof request.status === 'string' && request.status.trim()
    && Number.isInteger(request.jobId) && request.jobId > 0 && request.jobId <= MAX_JOB_ID
    && (jobId === undefined || request.jobId === jobId));
}

function invalidResponseError(statusHint) {
  const error = new Error(`Invalid Trackly Apply (cloud) response. ${statusHint}`);
  error.code = 'invalid_auto_apply_response';
  return error;
}

/** Require real request identities before reporting a successful response. */
function validateAssistResponse(result, { list = false, jobId, statusHint = CLI_STATUS_HINT } = {}) {
  const requests = list ? result?.requests : [result?.request];
  if (!Array.isArray(requests) || requests.some(request => !validRequest(request, jobId))) {
    throw invalidResponseError(statusHint);
  }
  return result;
}

/** Preserve the backend's missing-job code, otherwise explain account availability. */
function autoApplyUnavailableError(error) {
  if (error?.error === 'job_not_found') {
    return Object.assign(new Error('Job not found. Check the Trackly job ID before requesting Trackly Apply (cloud).', { cause: error }), {
      status: 404, error: 'job_not_found', code: 'auto_apply_job_not_found',
    });
  }
  const diagnostic = safeDiagnostic(error?.message) || safeDiagnostic(error?.error);
  return Object.assign(new Error('Trackly Apply (cloud) is not available for this account yet.', { cause: error }), {
    status: 404, error: 'feature_disabled', feature: 'assist_request',
    ...(diagnostic && diagnostic !== 'feature_disabled' ? { diagnostic } : {}),
  });
}

/** An interrupted enqueue may have succeeded; require a status check first. */
function autoApplyRequestError(error, { statusHint = CLI_STATUS_HINT } = {}) {
  if (['invalid_auto_apply_response', 'maintenance_mode', 'ACCESS_CHECK_UNAVAILABLE'].includes(error?.code) || (error?.status && error.status < 500)) return error;
  const diagnostic = safeDiagnostic(error?.error) || safeDiagnostic(error?.message) || 'Trackly Apply (cloud) request failed';
  return Object.assign(new Error(`${diagnostic}. ${statusHint}`, { cause: error }), {
    code: 'auto_apply_status_unknown', ...(error?.status ? { status: error.status } : {}),
  });
}

/** The fields the MCP returns for one request, as the hosted requestView projects them. */
function requestView(value, expectedJobId) {
  const request = record(value);
  if (!request || !validRequest(request, expectedJobId)) return null;
  const text = (key) => (typeof request[key] === 'string' ? request[key] : null);
  return {
    id: request.id,
    jobId: request.jobId,
    company: text('company'),
    jobTitle: text('jobTitle'),
    status: request.status,
    failureCode: text('failureCode'),
    applicantMessage: text('applicantMessage'),
    createdAt: text('createdAt'),
    updatedAt: text('updatedAt'),
    completedAt: text('completedAt'),
  };
}

/**
 * POST /api/jobscout/apply/assist-requests for the MCP tool. It always sends `acknowledged: true`
 * (Kevin, 2026-11-10 PST; close-ai #3536): requesting Trackly Apply (cloud) is the user's consent for
 * Trackly staff to use every profile answer, sensitive ones included, to complete the application.
 * The model cannot change it: the input schema is strict and accepts only jobId.
 */
async function requestAutoApply(api, jobId) {
  let response;
  try {
    response = await api('POST', '/api/jobscout/apply/assist-requests', { jobId, acknowledged: true });
  } catch (error) {
    if (error?.status === 404) throw autoApplyUnavailableError(error);
    throw autoApplyRequestError(error, { statusHint: MCP_STATUS_HINT });
  }
  const view = requestView(record(response)?.request, jobId);
  if (!view) throw invalidResponseError(MCP_STATUS_HINT);
  const { id, jobId: requestJobId, company, jobTitle, status } = view;
  return { request: { id, jobId: requestJobId, company, jobTitle, status }, message: AUTO_APPLY_QUEUED_MESSAGE };
}

/** GET /api/jobscout/apply/assist-requests for the MCP tool, newest first, bounded for the model. */
async function listAutoApplyRequests(api, jobIds) {
  const query = Array.isArray(jobIds) && jobIds.length > 0 ? `?jobIds=${[...new Set(jobIds)].join(',')}` : '';
  let response;
  try {
    response = await api('GET', `/api/jobscout/apply/assist-requests${query}`);
  } catch (error) {
    if (error?.status === 404) throw autoApplyUnavailableError(error);
    throw error;
  }
  const rows = record(response)?.requests;
  if (!Array.isArray(rows)) {
    const error = new Error('Trackly returned an unexpected Trackly Apply (cloud) response.');
    error.code = 'invalid_auto_apply_response';
    throw error;
  }
  const requests = rows.map((row) => requestView(row)).filter((row) => row !== null);
  return { requests: requests.slice(0, MAX_STATUS_REQUESTS), hasMore: requests.length > MAX_STATUS_REQUESTS };
}

module.exports = {
  AUTO_APPLY_DESCRIPTION,
  AUTO_APPLY_QUEUED_MESSAGE,
  AUTO_APPLY_SEARCH_FIELD_DESCRIPTION,
  AUTO_APPLY_STATUS_DESCRIPTION,
  AUTO_APPLY_STATUS_TITLE,
  AUTO_APPLY_TITLE,
  CLI_STATUS_HINT,
  MAX_JOB_ID,
  MAX_STATUS_JOB_IDS,
  MAX_STATUS_REQUESTS,
  MCP_STATUS_HINT,
  assistPostingTarget,
  autoApplyRequestError,
  autoApplyUnavailableError,
  jobAutoApplySupported,
  listAutoApplyRequests,
  requestAutoApply,
  validateAssistResponse,
  withAutoApplySupport,
};
