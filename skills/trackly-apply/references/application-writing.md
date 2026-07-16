# Application writing integrity

Use this reference for free-text questions such as "Why this company?", motivation, or experience summaries.

## Calibrate once

- Read `writing.voice_sample` and `writing.style_instructions` from the resolved Trackly profile.
- If either required field is unknown, ask during onboarding and synchronize the answer before browser work. Let the user decline a voice sample or choose intentionally blank style instructions.
- Treat the sample and preferences as private user data. Never copy them into the public skill, logs, observations, or another user's defaults.
- A separate humanizer or writing skill may be used when available, but it is optional. This gate remains authoritative and self-contained.

## Draft from evidence

1. Answer the exact question using only canonical profile facts, resume evidence, and specific facts visible in the job posting.
2. Lead with the concrete overlap between the user's experience and the role. Avoid generic company praise or unsupported enthusiasm.
3. Prefer one or two specific proofs over a broad inventory of strengths. Never invent an achievement, employer, skill, or motivation.
4. Keep the response proportionate to the form. Short questions should receive short answers.

## Match the user's voice

- Match the sample's register, sentence length, paragraph breaks, first-person usage, punctuation, and level of informality.
- Honor explicit style instructions over generic defaults.
- Preserve readable quirks and personality. Do not polish every sentence into the same formal register.
- When no sample is available, default to plain first-person language, short paragraphs, and concrete evidence.

## Anti-slop gate

Before entering the response:

1. Remove generic praise, inflated claims, vague transitions, boilerplate conclusions, and chatbot phrases.
2. Rewrite `not just X, but Y`, ornamental rule-of-three lists, and dangling `-ing` clauses unless the user's sample clearly uses them naturally.
3. Use no em dash by default. Use one only when the user's sample or saved instructions show that punctuation is part of their voice.
4. Vary sentence length and structure. Avoid a sequence of equally sized, equally formal sentences.
5. Prefer active verbs, concrete nouns, real numbers, and named examples already supported by the profile.
6. Read the answer aloud. If it sounds like a press release, generic cover letter, or assistant response, rewrite it.
7. Compare the final response with the voice sample for rhythm and register, then confirm every factual claim again.
