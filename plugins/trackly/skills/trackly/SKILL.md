---
name: trackly
description: Search trackly for current jobs and companies, inspect job briefs and preferences, and save only the jobs the user chooses. Use when the user asks to find, compare, inspect, or track job openings.
---

# trackly

Use trackly as the source of truth for current openings, monitored companies, saved jobs, and discovery preferences.

## Connection and account

An installed skill does not prove its authenticated tools are connected. If the needed trackly tools are missing, inspect the host's plugin connection and use its supported Connect or Sign in action before asking the user to supply jobs or open another app. Let the user complete sign-in and consent. Select a Google or Trackly identity only when the user identified that account; a matching name, default, preselected, or recently used account is not enough.

For an established connector, a successful authenticated read-only call is sufficient connection evidence; do not require an old login receipt or reconnect it. For a newly initiated or pending sign-in, verify host-reported completion, fresh tool discovery, and a successful read-only call. An Allow click or OAuth callback alone does not prove the host saved authorization. When connection fails or an account switch still returns old state, follow [connection readiness](../trackly-apply/references/connection-readiness.md) for supported browser recovery, bounded retries, and host discovery refresh. Keep credentials and callback parameters out of output and configuration edits.

Use a non-secret authenticated account label when the host or tools expose one. If saved preferences or jobs contradict the user's current account, compare available identity evidence before claiming their queue is empty. If identity cannot be verified, state only that the connected account returned those results and ask one targeted account question when needed; do not infer identity from a name or profile revision. No native Trackly app is required for this hosted connector.

## Search workflow

1. If the request depends on saved preferences, call `trackly_get_preferences` before searching. Do not invent a preference that is missing.
2. Call `trackly_search_jobs` with the user's explicit constraints. Preserve recency, location, remote, company, and role constraints exactly.
3. Use `trackly_search_companies` only when company discovery or company identity is part of the request.
4. Use `trackly_get_job` for the exact posting record and `trackly_get_job_brief` for a decision-ready summary. Treat `postedLast7d` and `latestPostedAt` as validated posting-date signals only; never substitute first-seen time for a posting date.
5. Present returned facts as returned by trackly. Label any model inference as an inference and never imply a posting is still open when trackly reports otherwise.
6. Call `trackly_update_status` only after the user chooses a job or explicitly asks to update its status. Marking a job `applied` additionally requires Apply write permission because it reconciles the application run; never use it to infer or claim submission.

Do not rescore an approved application inside this discovery skill. When the user asks to fill an approved application, use the `trackly-apply` skill.

## Scope boundary

This plugin supports job and company search, job briefs, tracking, and application filling. Employee discovery and referral intelligence are outside its scope.
