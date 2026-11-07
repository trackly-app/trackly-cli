'use strict';

/** Require real request identities before reporting a successful response. */
function validateAssistResponse(result, { list = false, jobId } = {}) {
  const requests = list ? result?.requests : [result?.request];
  if (!Array.isArray(requests) || requests.some(request => !request
    || typeof request.id !== 'string' || !request.id.trim()
    || typeof request.status !== 'string' || !request.status.trim()
    || !Number.isInteger(request.jobId) || request.jobId <= 0 || request.jobId > 2147483647
    || (jobId !== undefined && request.jobId !== jobId))) {
    const error = new Error('Invalid auto-apply response. Check your request status with trackly apply --status before requesting again.');
    error.code = 'invalid_auto_apply_response';
    throw error;
  }
  return result;
}

/** Preserve the backend's missing-job code, otherwise explain account availability. */
function autoApplyUnavailableError(error) {
  if (error?.error === 'job_not_found') {
    return Object.assign(new Error('Job not found. Check the Trackly job ID before requesting auto-apply.', { cause: error }), {
      status: 404, error: 'job_not_found', code: 'auto_apply_job_not_found',
    });
  }
  const rawDiagnostic = typeof error?.message === 'string' ? error.message
    : typeof error?.error === 'string' ? error.error : null;
  const diagnostic = rawDiagnostic?.replace(/[\u0000-\u001f\u007f]/g, '');
  return Object.assign(new Error('Auto-apply is not available for this account yet.', { cause: error }), {
    status: 404, error: 'feature_disabled', feature: 'assist_request',
    ...(diagnostic && diagnostic !== 'feature_disabled' ? { diagnostic: diagnostic.slice(0, 500) } : {}),
  });
}

/** An interrupted enqueue may have succeeded; require a status check first. */
function autoApplyRequestError(error) {
  if (['invalid_auto_apply_response', 'maintenance_mode', 'ACCESS_CHECK_UNAVAILABLE'].includes(error?.code) || (error?.status && error.status < 500)) return error;
  const diagnostic = error?.error || error?.message || 'Auto-apply request failed';
  return Object.assign(new Error(`${diagnostic}. Check your request status with trackly apply --status before requesting again.`, { cause: error }), {
    code: 'auto_apply_status_unknown', ...(error?.status ? { status: error.status } : {}),
  });
}

module.exports = { validateAssistResponse, autoApplyUnavailableError, autoApplyRequestError };
