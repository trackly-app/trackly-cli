# Release gates

These gates govern OpenAI submission and publication of the plugin listing. Repository merges and npm CLI releases follow the normal reviewed release workflow; neither proves OpenAI portal acceptance. The plugin must not be submitted to OpenAI or published in its directory until every applicable gate below is satisfied.

## OpenAI Platform draft

- Keep the final-directory listing metadata internally consistent: the manifest
  `interface.shortDescription` and portal short description must be the same
  truthful value and contain 30 characters or fewer. Preserve the manual-review boundary in the long
  description and submission tests; the short description must not imply
  autonomous submission.
- Describe the shipped service as production-ready and free; do not call it a
  trial, demo, beta, or pilot in public listing copy. A synthetic reviewer
  account and a demonstration recording are review evidence, not a claim that
  the product itself is a trial or demo.
- Populate and verify the portal Support URL (`https://usetrackly.app/support`)
  alongside the website, privacy-policy, and terms URLs. Keep the support URL in
  `listing/metadata.json` and enter it explicitly in the portal; portal values must be verified against the current portal schema rather than inferred from the package alone.
- Verify the submitting OpenAI Platform organization as an individual or business and confirm the submitting account has Apps Management Write (`api.apps.write`) access; read access (`api.apps.read`) is also needed to inspect review status.
- Create a new **With MCP** draft at `https://platform.openai.com/plugins`. Submit the production MCP from scratch through the portal even if it was previously connected in ChatGPT or Codex.
- Configure the Universal MCP URL as `https://mcp.usetrackly.app/api/plugin/trackly/mcp` and complete any portal-issued domain verification challenge at the exact required `/.well-known/openai-apps-challenge` path.
- Do not invent, pre-allocate, or package a ChatGPT developer-mode app ID. `.app.json` and an `apps` manifest binding remain absent; `.mcp.json` remains the Codex remote MCP connection and must not include `oauth_resource`. The client discovers the resource through MCP protected-resource metadata. Repeating the production URL as `oauth_resource` duplicates the RFC 8707 `resource` parameter in affected Codex versions.
- Complete the portal listing, authentication and reviewer-access details, skill bundle, starter prompts, regional availability, release notes, policy attestations, and scanned tool metadata without selecting **Submit for Review**.
- Enter the dedicated MCP plugin-review email and password in the reviewer-access fields. The production consent page must accept them directly without Google, Apple, account creation, MFA, OTP, email/SMS verification, private-network access, or any other setup.
- Re-run plugin validation and the repository test suite after any portal-driven package or MCP change.

### Automated package preflight

The offline source preflight uses development-only YAML, XML and image parsers. It checks
actual screenshot dimensions and decoding, required reviewer-environment fields,
and legal-URL parity. Live mode checks authorization-code discovery. The reviewed manual-submit
sentence is pinned verbatim (apart from Unicode/whitespace normalization); changing that safety claim
requires reviewing and updating the contract, not just retaining a keyword.
Non-empty screenshot lists require one image per starter prompt, and portal
prompts must match their corresponding synthetic fixtures. Skill companion YAML,
manifest placeholders, strict absolute HTTPS URLs and safe asset paths are
validated against the existing ingestion contract. The installed Codex validator
accepts `defaultPrompt` and `default_prompt`; conflicting aliases fail. It rejects
manifest `supportURL`, so keep that URL in listing metadata and the portal even
though the public portal documentation lists it as an interface field.

The validation limits follow the [OpenAI submission error reference](https://developers.openai.com/plugins/deploy/submission-errors); the portal remains authoritative.

- Run `npm run test:plugin-submission` from this source checkout. This is a
  maintainer command, like the hosted-contract checks, and is not a command
  shipped to npm consumers. The plugin directory is a separate submission
  artifact, not part of the CLI tarball. Portal Support URL parity remains a
  manual check. The preflight validates the
  final-directory manifest limits, HTTPS/legal URLs, listing support URL validity,
  package paths and assets, absence of developer-mode app bindings, skill
  frontmatter, credential assignments, and the reviewer fixture shape.
- After the production deployment is frozen, run
  `npm run test:plugin-submission -- --live --json` and retain the redacted
  output with the deployment SHA. The live mode never reads credentials; it
  checks the public 401 challenge, protected-resource metadata, authorization
  server metadata, PKCE advertisement, exact resource identity, and origin
  behavior. Use `--require-challenge` only after the portal has provisioned the
  domain-verification token. For that run, provide the exact public challenge value through `OPENAI_CHALLENGE_TOKEN`; the probe requires a byte-for-byte body match and never prints either value. This is a public domain-verification value, not an OAuth credential. Use `--strict-origins` only after confirming
  which official client origins the target Codex/ChatGPT surface sends.

### OAuth and MCP protocol gate

- Make the `issuer` value in authorization-server metadata byte-for-byte equal
  to the value in protected-resource `authorization_servers`; do not rely on
  client URL normalization. If stable callback mode is enabled, advertise
  `authorization_response_iss_parameter_supported: true` and return `iss` on
  every success and error callback. Otherwise use the exact callback-specific
  redirect URI required by the client and test it explicitly.
- Confirm the deployed `MCP_AUTH_DOMAIN` is
  `https://mcp.usetrackly.app`, not the source-code fallback
  `https://usetrackly.app`. Confirm `MCP_PLUGIN_RESOURCE` remains the dedicated
  `/api/plugin/trackly/mcp` URL and that tokens are audience-bound to it.
- With the submitted reviewer account, execute the full OAuth 2.1 + PKCE flow,
  then call `initialize`, `server/discover`, `tools/list`, and one read-only
  fixture. `server/discover` must return HTTP 200 with JSON-RPC `-32601`
  (method not found), never HTTP 401/403 or an insufficient-scope error.
- Test refresh, revoke, expired-token, wrong-resource, wrong-audience, and
  missing-header failures. Retain only redacted status/metadata evidence; do
  not store passwords, authorization codes, access tokens, or personal data.
- Leave workspace-domain restrictions disabled unless the deployed
  authorization-server metadata advertises a UserInfo endpoint that returns
  `email` and `email_verified` and the requested authorization includes the
  documented `openid` and `email` scopes. The current public metadata does not
  meet that prerequisite, so selecting the restriction prematurely would make
  review fail.
- Decision (2026-09-18 PDT): no UserInfo endpoint is required for this
  submission. OpenAI's submission guide
  (<https://developers.openai.com/plugins/deploy/submission>) ties it only to
  workspace domain restrictions: "To support workspace domain restrictions for
  a plugin that uses OAuth, configure the authorization server to advertise a
  UserInfo Endpoint that returns the user's email claim and email_verified:
  true." trackly does not use workspace domain restrictions, so no code change
  is made. Revisit this only if domain restrictions are ever enabled.

### Custom UI, CSP, and screenshots

- After **Scan Tools**, inspect every imported tool descriptor and `_meta` entry
  for `ui://` resources, `openai/outputTemplate`, widget metadata, and CSP
  declarations. The current Trackly facade intentionally exposes a private
  Apply status UI with `connectDomains: []` and `resourceDomains: []`; enter
  those exact values in the portal and explain any frame-domain prompt rather
  than broadening the policy for convenience.
- If the scan reports a UI output template, decide explicitly whether the
  listing uses screenshots. When screenshots are included, capture the real
  rendered UI from the submitted build—one PNG/JPEG per starter prompt, exactly
  706 pixels wide and 400–860 pixels high. Never fabricate screenshots or use
  stale pre-fix captures. If no UI is intended for the final version, remove
  the output-template metadata in the owning backend and rescan; do not merely
  omit screenshots while leaving the scan ambiguous. If the final version does
  return UI, screenshots are optional but the CSP and all UI metadata still must
  be reviewed; if it does not return UI, do not upload screenshots.
- Rerun **Scan Tools** after any tool annotation, schema, widget, CSP, or
  resource-URI change and retain the scan timestamp/version with the review
  packet. Tool annotations (`readOnlyHint`, `openWorldHint`, and
  `destructiveHint`) must describe actual behavior and have a short reviewer
  justification for every write or external side effect.

### Tool annotation justifications

Audited on 2026-09-18 PDT against the OpenAI plugin submission guide
(developers.openai.com/plugins/deploy/submission): `readOnlyHint` is true only
when a tool changes nothing; `openWorldHint` is true only for the public
internet or open-ended external entities, and false for a bounded private
account "even if that service is externally hosted"; `destructiveHint` is true
for a write that can delete, overwrite, revoke access, or cause another
irreversible side effect. The backend source is
`close-ai/src/mcp/plugin-server.ts`. `plugin-server.test.ts` locks every row
below, so a change to any hint fails CI. Paste these one-line justifications
into the portal.

`openWorldHint` is false for all 21 tools. Every tool calls only Trackly's own
API, scoped to the signed-in account. The Apply services have no outbound
network client and never fetch employer sites. Stored postings are served
without live employer-site hydration. Employer pages are opened and filled by
the host's own browser tool, and only the user clicks Submit.

| Tool | Read only | Destructive | Justification |
| --- | --- | --- | --- |
| `trackly_search_jobs` | true | false | Searches Trackly's stored job index for this account. Writes nothing. |
| `trackly_get_job` | true | false | Reads one stored posting. No live employer-site fetch. |
| `trackly_search_companies` | true | false | Searches Trackly's monitored-company list. |
| `trackly_get_job_brief` | true | false | Reads a precomputed role and company summary. |
| `trackly_get_preferences` | true | false | Reads the user's saved discovery preferences. |
| `trackly_get_apply_readiness` | true | false | Makes five parallel GETs for profile, schema, queue, protocol and execution state. |
| `trackly_lint_application_text` | true | false | Computes in memory only. Text is neither stored nor echoed. |
| `trackly_list_apply_access_deferments` | true | false | Lists the account's active deferments. |
| `trackly_prepare_resume_artifact` | true | false | Reads the original saved résumé and issues a private expiring preview; never attaches or submits. |
| `trackly_update_status` | false | false | Sets a tracker stage (saved, dismissed or applied). The same tool reverses it. |
| `trackly_save_application_answers` | false | true | Overwrites saved profile answers. The education list is a confirmed replace-all. |
| `trackly_grant_sensitive_storage_consent` | false | false | Records consent only. Adds no answers and can be revoked. |
| `trackly_revoke_sensitive_storage_consent` | false | true | Revokes consent and deletes stored sensitive answers. |
| `trackly_defer_apply_access` | false | false | Inserts an owner-scoped deferment that keeps Apply off that job, company or provider until `trackly_clear_apply_access_deferment` clears it (it has no expiry). Nothing is deleted. |
| `trackly_clear_apply_access_deferment` | false | false | Soft-clears one deferment (`cleared_at`), which can be re-deferred. |
| `trackly_start_or_resume_apply` | false | false | Creates or resumes a no-submit Apply execution and claims its batch lease. |
| `trackly_get_apply_work` | false | false | Not read-only, because each call claims or renews the private batch lease. |
| `trackly_report_apply_progress` | false | false | Records exact-document approval, value-free observations and dispositions, or advances the execution to its next wave. Advancing only queues new no-submit work and never deletes or overwrites user data. |
| `trackly_certify_review_ready` | false | false | Records a review-ready checkpoint. Never submits. |
| `trackly_reconcile_manual_submission` | false | false | Records a submission the user made themselves. Never submits forms. |
| `trackly_stop_apply` | false | true | Moves the execution to a terminal stopped state. Continuing requires a new execution. |

The fixture-pinned `mutationAnnotationContract` in
`scripts/verify-hosted-contract.js` mirrors the runtime pinned in
`hosted-contract-fixture.json`. trackly-app/trackly-cli#154 recaptures that
fixture from the deployed close-ai merge `dded739620bcdee1e6863324c8f660e6b999d0cc` (close-ai #2014), retaining
`trackly_defer_apply_access` and `trackly_clear_apply_access_deferment` to
`mutationAnnotations(false, true)`, matching the table above.
The backend helper's signature is
`mutationAnnotations(destructiveHint, idempotentHint)`, and it always emits
`readOnlyHint: false` and `openWorldHint: false`. So `(false, true)` means
non-destructive, which matches the Destructive column above, and idempotent (retries replay by idempotency key; the table does not list idempotency). The helper
`readOnlyAnnotations` emits read-only, non-destructive and idempotent.

## Product verification

- Require an unauthenticated HTTP 200 response from `https://usetrackly.app/plugins/trackly` and verify its logo, support, privacy, and terms links before submission.
- Run `npm run test:hosted-contract` without `TRACKLY_BACKEND_DIR` and require the checked-in hosted-tool contract fixture to pass in the standalone CLI checkout.
- Separately run `TRACKLY_BACKEND_DIR=/absolute/path/to/granola-followup-app npm run test:hosted-contract` against the exact backend release candidate and require the executable plugin catalog to match the locked 21-tool allowlist.
- Run `TRACKLY_BACKEND_DIR=/absolute/path/to/granola-followup-app npm run test:review-auth-contract` against the exact deployed reviewer-auth runtime and require its dedicated identity, credential, migration, token-lifecycle, and plugin-resource bindings to pass. This is independent of the fixture-pinned Trackly Apply provenance gate above; do not require both checks to use the same historical backend checkout.
- Execute all six internal positive and all three negative `listing/submission-tests.json` fixtures with the synthetic reviewer account. The OpenAI portal accepts exactly five positive cases: submit only the five IDs listed in `reviewEnvironment.portalPositiveCaseIds`, plus all three negative cases. Preserve the result shapes, tool sequence, exact-resume approval and attachment evidence (or explicit manual fallback), and forbidden-action evidence for the submission packet.
- Use the reviewer-facing briefs in `listing/submission-tests.json` when copying
  cases into the portal. They are deliberately separate from internal tool
  traces and must remain self-contained: prompt, fixture data, expected
  workflow/result, and (for negatives) why the request is out of scope.
- From a clean external browser with no Trackly or identity-provider session, use the exact credentials copied into the OpenAI submission and prove consent, direct password sign-in, authorization-code exchange, token validation, MCP initialization, `tools/list`, and one read-only fixture. Record the timestamp and redacted result; never record the password or tokens. A Google/Apple sign-in or a source-only/unit-test result does not satisfy this gate.
- Prove readiness exposes only canonical missing-profile keys and public labels; start/resume returns the claimed batch-bound wave without crossing OAuth grants; review certification lands its checkpoint, truth certification, and review-ready outcome atomically while binding verified approved originals and leaving unverified manual resumes unbound; and manual reconciliation lands typed evidence and submitted outcome atomically.
- Prove the authenticated facade owns batch leases and no public tool schema or result exposes a lease token to the model.
- Prove the facade renews its private lease on every work and mutation path and returns only the bounded progress projection, never raw run results or identifiers.
- Logo approval complete: after a side-by-side comparison with the approved PNG, on 2026-08-10 Pacific Time Kevin approved the exact packaged `assets/trackly-appicon.svg` bytes with SHA-256 `1bd52951de41a49bb87813207884797619390a82c0992ad5a1ea2d447daee21c` for the OpenAI listing. The approval covers the logo only and does not authorize OpenAI Submit or Publish. Any packaged-asset byte change invalidates this approval and requires a new side-by-side comparison and explicit approval.
- Verify the full search-to-review flow in ChatGPT Work on desktop.
- Verify the full search-to-review flow in Codex desktop.
- Record the portal-required demo covering Trackly's main use cases on ChatGPT web, iOS, and Android, and attach that recording to the OpenAI Platform draft before submission.
- Include at least one application whose form requires the user-approved resume artifact.
- Confirm the final Submit control remains untouched in every run.

### Submission status and version control

- Check the Platform draft status before creating another version. Do not create
  a duplicate while an earlier version is still in review; the portal permits
  only one MCP version in review at a time.
- Any change to the manifest, tool schemas/annotations, UI/CSP, or imported
  skills requires a new plugin version, a new production deployment where
  applicable, and a fresh Scan Tools snapshot. Do not assume an old scan sees
  live changes.
- Submit the `plugins/trackly` directory as the single plugin root. Do not use
  the root npm package archive, include sibling repository files, or package
  credentials, local `.env` files, debug logs, or internal evidence.

### Data, policy, and listing consistency

- Keep the public copy explicit that matching reflects user preferences and job
  metadata, not employer hiring decisions or protected-trait candidate ranking.
- Verify that every job source and ATS integration is authorized and does not
  bypass access controls. Keep the source/terms evidence with the review packet.
- Reconcile tool outputs with the privacy policy: collect and return only the
  fields needed for the requested workflow, explain sensitive-field consent,
  document recipients and retention, and remove unnecessary IDs/debug data.
- Ensure pricing, US availability, browser-control requirements, supported
  client surfaces, and the manual-submit boundary are identical in the portal,
  website, README, demos, and test fixtures.
- Confirm the privacy policy names the personal-data categories collected by the
  MCP flow, purposes, recipients, retention/deletion, and user controls. Keep
  reviewer fixtures synthetic, minimize returned fields and internal IDs, and
  do not place credentials, tokens, authorization codes, or private evidence in
  the package or screenshots.

## Submission control

- Kevin must approve the exact listing, packaged logo asset, privacy and terms URLs, test cases, scanned tool metadata, production MCP URL, regional availability, release notes, and policy attestations immediately before selecting **Submit for Review**.
- **Submit for Review** is a separate action from publication. Draft creation, domain verification, tool scanning, and draft validation do not authorize submission.
- After OpenAI approval, ask Kevin again immediately before selecting **Publish**.

### Original résumé release proof

- Preview the saved original filename, size and SHA-256; do not regenerate bytes from extracted text. Verify expiry, grant revocation, auth epoch changes and replacement invalidate access.
- Preview is not upload approval. Record explicit consent for the exact file and current execution.
- Test actual retrieval and upload on each supported host; MCP Apps support alone does not prove attachment support. Use an honest manual handoff where unavailable.
- Verify original bytes before upload and the visible employer filename afterward. Later removal, failure, changed bytes or stale approval must block review readiness.
- Preserve a visible editable employer form. Picture-in-picture and remote streaming are deferred.
- Select current job IDs from tool results; never claim placeholder jobs or an undeployed form exist. The fifth portal positive case resumes interrupted work. Manual-submission reconciliation remains an internal case requiring actual evidence.

Private resume access is component-only tool-result metadata, never model-visible content. Prove a documented secure host-mediated materialization path before claiming automatic attachment. Otherwise the user downloads the original through the preview component and attaches it manually; keep that upload unbound.
