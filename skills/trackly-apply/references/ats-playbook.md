# ATS playbook

## Greenhouse

- Accept employer-hosted Greenhouse forms and `job-boards.greenhouse.io` / `boards.greenhouse.io` application hosts after matching the employer and role.
- Expect resume parsing, React selects, correction banners, demographic sections, and final consent checkboxes.
- Treat red required-field text as authoritative even when a value is visible.
- A Greenhouse “Thank you for applying” page is a valid submission signal.

## Ashby

- Accept `jobs.ashbyhq.com` only after matching the employer and role.
- Expect rerenders, masked contact inputs, and controls whose visible text can differ from committed state.
- Best effort: stop when browser and accessibility state disagree.
- An explicit application-success banner/page is a valid submission signal.

## Lever

- Accept `jobs.lever.co` and verified employer-hosted Lever forms after matching the employer and role.
- Expect native inputs mixed with custom selects and optional resume parsing.
- Best effort: stop when a required or semantic control cannot pass the integrity gate.
- A Lever confirmation/thank-you page is a valid submission signal.

## Unsupported or verification state

- Do not improvise on unsupported ATS platforms.
- Pause for OTP, email verification, CAPTCHA, or other human verification. Never read or store the code as a profile answer.
- Report closed/inactive postings as blockers; do not dismiss the saved job unless the user requests it.
