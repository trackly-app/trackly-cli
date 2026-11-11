---
name: trackly
description: Search trackly for current jobs and companies, inspect job briefs and preferences, save only the jobs the user chooses, request trackly Apply (cloud) for a job the user names, and mark a job applied. Use when the user asks to find, compare, inspect, or track job openings, asks trackly to apply to a job for them, or says they applied.
---

# trackly

Use trackly as the source of truth for current openings, monitored companies, saved jobs, and discovery preferences.

## Search workflow

1. If the request depends on saved preferences, call `trackly_get_preferences` before searching. Do not invent a preference that is missing.
2. Call `trackly_search_jobs` with the user's explicit constraints. Preserve recency, location, remote, company, and role constraints exactly.
3. Use `trackly_search_companies` only when company discovery or company identity is part of the request.
4. Use `trackly_get_job` for the exact posting record and `trackly_get_job_brief` for a decision-ready summary. Treat `postedLast7d` and `latestPostedAt` as validated posting-date signals only; never substitute first-seen time for a posting date.
5. Present returned facts as returned by trackly. Label any model inference as an inference and never imply a posting is still open when trackly reports otherwise.
6. Call `trackly_update_status` only after the user chooses a job or explicitly asks to update its status. Marking a job `applied` is for an application the user submitted themselves. It additionally requires Apply write permission because it reconciles the application run, and it also records the job on the user's trackly Tracker board, so there is no separate Tracker step. Check the result's `trackerEntry`: `created`, `linked`, `moved` or `existing` means the job is on the board. `skipped` or `failed`, or no `trackerEntry` at all (an older server), means the board was not updated: say so, and never report the job as tracked. The applied status is still saved, and a `failed` Tracker step is safe to retry with the same call. Saving or dismissing changes only the job list; never use it to infer or claim submission.

Do not rescore an approved application inside this discovery skill. When the user asks to finish Apply setup, resolve missing profile or resume requirements, or fill an approved application, use the `trackly-apply` skill.

## Three ways to apply

Keep these apart and pick the one the user asked for:

1. **trackly Apply (local):** the user's own agent fills the application in a controlled browser and stops before Submit; the user submits. Use the `trackly-apply` skill.
2. **trackly Apply (cloud):** the user only requests it and Trackly applies to the employer for them, with the saved resume and every saved profile answer, sensitive ones included; nothing runs on the user's computer. Call `trackly_auto_apply` once per job, only when the user explicitly asks trackly to apply to that exact job for them. Never call it as a suggestion, as a fallback when local filling stops, or for jobs the user did not name. If a request fails or its outcome is unknown, check `trackly_auto_apply_status` before asking again; never retry on your own. Search results mark supported postings with `autoApplySupported`. Use `trackly_auto_apply_status` to report request progress; never claim submission before it reports `submitted`.
3. **Mark applied:** the user applied on their own. Call `trackly_update_status` with `applied` only after the user says so.

## Scope boundary

This plugin supports job and company search, job briefs, tracking, and application filling. Employee discovery and referral intelligence are outside its scope.
