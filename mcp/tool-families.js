'use strict';

// Trackly MCP tool families (close-ai #3619). This is a copy of close-ai
// src/mcp/tool-families.ts, plus the four tools only the npm server lists
// (LOCAL_ONLY_TOOL_NAMES). test/tool-families.test.js compares the two for every
// shared name when TRACKLY_BACKEND_DIR points at a close-ai checkout, and the
// release-time hosted-contract check does the same, so they cannot drift silently.
//
// Tool names, input schemas, scopes and output shapes never change here. Only the
// title ("<Family> · <Action>") and the description tag ("[<Family>] ") come from
// this file, applied once at registration by the McpServer subclass below, so the
// registration call sites (and the verifier that parses them by position) keep
// their exact shape and their tag-free description literals.

const { McpServer: SdkMcpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

const TITLE_SEPARATOR = ' · ';
const TITLE_MAX_LENGTH = 64;

// Catalog order. `sentence` follows the tag at the start of each description.
const TOOL_FAMILIES = Object.freeze([
  Object.freeze({ id: 'jobs', label: 'Jobs', tag: 'Jobs', sentence: '' }),
  Object.freeze({ id: 'companies', label: 'Companies', tag: 'Companies', sentence: '' }),
  Object.freeze({ id: 'network', label: 'Network', tag: 'Network', sentence: '' }),
  Object.freeze({ id: 'preferences', label: 'Preferences', tag: 'Preferences', sentence: '' }),
  Object.freeze({ id: 'profile', label: 'Profile', tag: 'Profile', sentence: '' }),
  Object.freeze({ id: 'job_status', label: 'Job status', tag: 'Job status', sentence: '' }),
  Object.freeze({ id: 'tracker', label: 'Tracker', tag: 'Tracker', sentence: '' }),
  Object.freeze({
    id: 'apply_local',
    label: 'Trackly Apply (local)',
    tag: 'Trackly Apply (local)',
    sentence: 'Your own AI agent fills the form in your browser and stops before Submit; you submit.',
  }),
  Object.freeze({
    id: 'apply_step',
    label: 'Apply step',
    tag: 'Trackly Apply · protocol step',
    sentence: 'Called by the Trackly Apply skill during a run, using IDs from earlier steps, not as a standalone action.',
    protocol: true,
  }),
  Object.freeze({
    id: 'apply_cloud',
    label: 'Trackly Apply (cloud)',
    tag: 'Trackly Apply (cloud)',
    sentence: 'Trackly applies for you and nothing runs on your computer.',
  }),
  Object.freeze({ id: 'chat', label: 'Chat', tag: 'Chat', sentence: '' }),
  Object.freeze({ id: 'feedback', label: 'Feedback', tag: 'Feedback', sentence: '' }),
]);

const FAMILY_BY_ID = new Map(TOOL_FAMILIES.map((family) => [family.id, family]));

// Tool name -> [family id, action]. Grouped in catalog order; the order inside a
// family is the order docs and listing kits use.
const TOOL_ACTIONS = Object.freeze({
  // Jobs
  trackly_search_jobs: ['jobs', 'Search'],
  trackly_get_job: ['jobs', 'Get details'],
  trackly_ask: ['jobs', 'Ask in plain language'],
  // Companies
  trackly_search_companies: ['companies', 'Search'],
  trackly_list_companies: ['companies', 'List tracked'],
  trackly_request_company: ['companies', 'Request monitoring'],
  // Network
  trackly_get_job_brief: ['network', 'Get job brief'],
  trackly_contacts_at_company: ['network', 'Find contacts'],
  trackly_get_company_workspace: ['network', 'Get company workspace'],
  // Preferences
  trackly_get_preferences: ['preferences', 'Get'],
  trackly_update_experience_limits: ['preferences', 'Set experience limits'],
  // Profile
  trackly_get_application_profile: ['profile', 'Get'],
  trackly_get_profile_onboarding: ['profile', 'Get setup status'],
  trackly_update_application_profile: ['profile', 'Update answers'],
  trackly_save_application_answers: ['profile', 'Save answers'],
  trackly_grant_sensitive_storage_consent: ['profile', 'Allow sensitive-answer storage'],
  trackly_revoke_sensitive_storage_consent: ['profile', 'Revoke sensitive-answer storage'],
  trackly_lint_application_text: ['profile', 'Check answer text'],
  // Job status
  trackly_update_status: ['job_status', 'Mark applied, saved or dismissed'],
  trackly_get_stats: ['job_status', 'Get counts'],
  // Tracker
  trackly_list_tracker_applications: ['tracker', 'List entries'],
  trackly_create_tracker_application: ['tracker', 'Add a job'],
  trackly_update_tracker_stage: ['tracker', 'Move stage'],
  trackly_add_tracker_note: ['tracker', 'Add note'],
  trackly_retract_tracker_event: ['tracker', 'Undo an event'],
  // Trackly Apply (local)
  trackly_get_apply_queue: ['apply_local', 'Get queue'],
  trackly_get_apply_readiness: ['apply_local', 'Check readiness'],
  trackly_start_or_resume_apply: ['apply_local', 'Start or resume'],
  trackly_get_apply_progress: ['apply_local', 'Get progress'],
  trackly_prepare_resume_artifact: ['apply_local', 'Preview resume'],
  trackly_list_apply_access_deferments: ['apply_local', 'List deferments'],
  trackly_defer_apply_access: ['apply_local', 'Defer a job, company or provider'],
  trackly_clear_apply_access_deferment: ['apply_local', 'Clear a deferment'],
  trackly_stop_apply_execution: ['apply_local', 'Stop a run'],
  trackly_stop_apply: ['apply_local', 'Stop'],
  // Apply step (protocol steps of a Trackly Apply run)
  trackly_get_apply_protocol: ['apply_step', 'Get protocol'],
  trackly_start_apply_execution: ['apply_step', 'Start a run'],
  trackly_get_active_apply_execution: ['apply_step', 'Recover active run'],
  trackly_get_apply_execution: ['apply_step', 'Get run'],
  trackly_get_apply_execution_snapshot: ['apply_step', 'Get run snapshot'],
  trackly_get_apply_snapshot: ['apply_step', 'Get member snapshot'],
  trackly_advance_apply_execution: ['apply_step', 'Advance run'],
  trackly_record_apply_execution_dispositions: ['apply_step', 'Record access results'],
  trackly_record_apply_dispositions: ['apply_step', 'Record access results'],
  trackly_resume_parked_apply_member: ['apply_step', 'Resume a parked job'],
  trackly_approve_apply_execution_resume: ['apply_step', 'Approve resume for run'],
  trackly_approve_apply_resume: ['apply_step', 'Approve resume'],
  trackly_list_recoverable_apply_executions: ['apply_step', 'List recoverable runs'],
  trackly_recover_exact_apply_members: ['apply_step', 'Recover jobs from a run'],
  trackly_list_apply_review_handoffs: ['apply_step', 'List review handoffs'],
  trackly_claim_apply_review_handoff: ['apply_step', 'Claim a review handoff'],
  trackly_create_apply_batch: ['apply_step', 'Create batch'],
  trackly_cancel_apply_batch: ['apply_step', 'Cancel batch'],
  trackly_get_apply_batch: ['apply_step', 'Get batch'],
  trackly_get_active_apply_batch: ['apply_step', 'Recover active batch'],
  trackly_claim_apply_batch: ['apply_step', 'Claim batch lease'],
  trackly_checkpoint_apply_batch: ['apply_step', 'Checkpoint batch'],
  trackly_bind_apply_surface: ['apply_step', 'Bind browser tab'],
  trackly_record_apply_surface_evidence: ['apply_step', 'Record tab evidence'],
  trackly_record_apply_submission_evidence: ['apply_step', 'Record submission evidence'],
  trackly_approve_apply_batch_resume: ['apply_step', 'Approve resume for batch'],
  trackly_certify_apply_batch_truth: ['apply_step', 'Certify answers'],
  trackly_start_apply_run: ['apply_step', 'Start a legacy run'],
  trackly_get_apply_evidence: ['apply_step', 'Get beta evidence'],
  trackly_report_apply_observation: ['apply_step', 'Report observation'],
  trackly_report_apply_observations: ['apply_step', 'Report observations'],
  trackly_record_apply_observations: ['apply_step', 'Record form observations'],
  trackly_record_application_outcome: ['apply_step', 'Record run outcome'],
  trackly_record_application_outcomes: ['apply_step', 'Record run outcomes'],
  trackly_certify_review_ready: ['apply_step', 'Mark ready for review'],
  trackly_reconcile_manual_submission: ['apply_step', 'Record a manual submission'],
  trackly_prepare_resume: ['apply_step', 'Prepare resume file'],
  trackly_verify_prepared_resume: ['apply_step', 'Verify resume file'],
  trackly_get_apply_work: ['apply_step', 'Get current work'],
  trackly_report_apply_progress: ['apply_step', 'Report progress'],
  trackly_diagnose_local_path: ['apply_step', 'Diagnose a local file path'],
  trackly_validate_apply_resume_upload: ['apply_step', 'Validate resume upload'],
  trackly_validate_apply_tab_keep_set: ['apply_step', 'Validate kept tabs'],
  // Trackly Apply (cloud)
  trackly_auto_apply: ['apply_cloud', 'Request'],
  trackly_auto_apply_status: ['apply_cloud', 'Check requests'],
  // Chat
  trackly_chat: ['chat', 'Ask Trackly'],
  // Feedback
  get_more_tools: ['feedback', 'Report a missing tool'],
});

// Listed only by the npm server, never by a hosted surface.
const LOCAL_ONLY_TOOL_NAMES = Object.freeze([
  'trackly_diagnose_local_path',
  'trackly_lint_application_text',
  'trackly_validate_apply_resume_upload',
  'trackly_validate_apply_tab_keep_set',
]);

/** The family entry and action for one tool name, or null when the name has none. */
function toolFamily(name) {
  if (!Object.prototype.hasOwnProperty.call(TOOL_ACTIONS, name)) return null;
  const [familyId, action] = TOOL_ACTIONS[name];
  const family = FAMILY_BY_ID.get(familyId);
  return { family, action, protocol: family.protocol === true };
}

function requireToolFamily(name) {
  const entry = toolFamily(name);
  if (!entry) {
    throw new Error(`MCP tool ${name} has no family in mcp/tool-families.js. Add it there, mirroring close-ai src/mcp/tool-families.ts.`);
  }
  return entry;
}

/** "<Family> · <Action>", the one title a tool name has on every surface. */
function toolTitle(name) {
  const { family, action } = requireToolFamily(name);
  return `${family.label}${TITLE_SEPARATOR}${action}`;
}

/** "[<Family>] " plus the family sentence, prepended to the source description. */
function descriptionPrefix(name) {
  const { family } = requireToolFamily(name);
  return `[${family.tag}] ${family.sentence ? `${family.sentence} ` : ''}`;
}

function labelDescription(name, description) {
  const text = typeof description === 'string' ? description : '';
  return `${descriptionPrefix(name)}${text}`.trimEnd();
}

/** Strip the family tag (and its sentence) so docs and catalogs can show the summary alone. */
function plainDescription(name, description) {
  const prefix = descriptionPrefix(name);
  return typeof description === 'string' && description.startsWith(prefix)
    ? description.slice(prefix.length)
    : description;
}

function labelRegisteredTool(name, registered) {
  const title = toolTitle(name);
  registered.title = title;
  registered.annotations = { ...(registered.annotations || {}), title };
  registered.description = labelDescription(name, registered.description);
  return registered;
}

/**
 * The SDK server, with family titles and tags applied as each tool registers.
 * A tool without a registry entry fails at registration, so a new tool cannot
 * ship unlabeled.
 */
class McpServer extends SdkMcpServer {
  tool(name, ...rest) {
    requireToolFamily(name);
    return labelRegisteredTool(name, super.tool(name, ...rest));
  }

  registerTool(name, config, callback) {
    requireToolFamily(name);
    return labelRegisteredTool(name, super.registerTool(name, config, callback));
  }
}

/** Tool names grouped by family, in catalog order. */
function toolNamesByFamily(names = Object.keys(TOOL_ACTIONS)) {
  const wanted = new Set(names);
  return TOOL_FAMILIES.map((family) => ({
    family,
    names: Object.keys(TOOL_ACTIONS).filter((name) => wanted.has(name) && TOOL_ACTIONS[name][0] === family.id),
  }));
}

module.exports = {
  LOCAL_ONLY_TOOL_NAMES,
  McpServer,
  TITLE_MAX_LENGTH,
  TITLE_SEPARATOR,
  TOOL_ACTIONS,
  TOOL_FAMILIES,
  descriptionPrefix,
  labelDescription,
  plainDescription,
  toolFamily,
  toolNamesByFamily,
  toolTitle,
};
