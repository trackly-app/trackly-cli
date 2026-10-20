'use strict';

const NEXT_SEARCH = {
  tool: 'trackly_search_jobs',
  message: 'Search for current openings or use another ID from search or your saved queue. Do not retry this job ID.',
};

function unavailableJob(jobId, reason, result = {}) {
  return {
    success: true,
    availability: 'unavailable',
    reason,
    jobId,
    message: 'This job is no longer available.',
    retryable: false,
    maxRetries: 0,
    nextStep: { ...NEXT_SEARCH },
    // Stored details can still explain a saved posting. A closed brief must
    // not carry networking actions that recommend applying to the old job.
    ...(result.job ? { job: result.job } : {}),
  };
}

function normalizeJobResult(result, jobId) {
  const posting = result?.job || result?.brief || result;
  // isActive is authoritative. Some older projections collapse unknown into
  // active=false, so never let that legacy flag override an explicit unknown.
  const active = posting && Object.hasOwn(posting, 'isActive') ? posting.isActive : posting?.active;
  return active === false
    ? unavailableJob(jobId, 'closed', result)
    : result;
}

function unavailableJobFromError(error, jobId) {
  if (error?.status !== 404 && error?.status !== 410) return null;
  const code = error.code || error.error;
  const reason = code === 'job_not_found' ? 'not_found'
    : code === 'job_removed' ? 'removed'
      : code === 'job_closed' ? 'closed' : null;
  if (reason) return unavailableJob(jobId, reason);
  // These are the two existing job-endpoint envelopes. A missing route, brief
  // dependency or unrelated resource must remain an error even at HTTP 404.
  if (error.status === 404 && (
    error.error === 'Job not found' || error.error === `Job ${jobId} not found`
  )) return unavailableJob(jobId, 'not_found');
  return null;
}

function jobFailureGuidance(error) {
  const status = error?.status;
  let category = 'unknown';
  if (Number.isInteger(status)) {
    if (status === 401) category = 'authentication';
    else if (status === 403) category = 'authorization';
    else if ([400, 413, 422].includes(status)) category = 'validation';
    else if ([404, 410].includes(status)) category = 'not_found';
    else if (status === 408) category = 'timeout';
    else if (status === 409) category = 'conflict';
    else if (status === 429) category = 'rate_limit';
    else if (status >= 500 && status <= 599) category = 'server';
  } else if (error?.code === 'ETIMEDOUT' || /timed out/i.test(error?.message || '')) {
    category = 'timeout';
  } else if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(error?.code)) {
    category = 'network';
  }
  const retryable = ['rate_limit', 'timeout', 'server', 'network'].includes(category);
  const messages = {
    authentication: 'Sign in again with trackly login or refresh the configured credential before trying again. Do not retry unchanged credentials.',
    authorization: 'Check account access before trying again. Repeating the same request will not grant access.',
    validation: 'Use the positive numeric Trackly job ID returned by search or your saved queue, then correct the request. Do not retry unchanged arguments.',
    not_found: 'The requested route or a brief dependency was not found. Search for a current posting or report the tool failure. Do not retry unchanged.',
    conflict: 'Refresh the job state and resolve the conflict before trying again. Do not retry unchanged.',
    rate_limit: 'Wait for the rate limit to reset before retrying this read once. Do not retry in a loop.',
    timeout: 'The read timed out. Wait briefly, then retry once. If it still fails, stop and try later.',
    server: 'Trackly could not complete this read. Wait briefly, then retry once. If it still fails, stop and try later.',
    network: 'Check the connection, then retry this read once. If it still fails, stop and try later.',
    unknown: 'The failure could not be classified. Check the request or report the tool failure. Do not retry unchanged.',
  };
  return {
    category,
    retryable,
    maxRetries: retryable ? 1 : 0,
    ...(retryable ? { retryAfterSeconds: category === 'rate_limit' ? 60 : 5 } : {}),
    error: 'Unable to retrieve this job right now.',
    nextStep: { message: messages[category] },
  };
}

module.exports = { normalizeJobResult, unavailableJobFromError, jobFailureGuidance };
