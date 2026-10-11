# Hosted OAuth discovery snapshot

The adjacent hosted-oauth-discovery-fixture.json captures public tool definitions from deployed backend PR2792 on October 11, 2026 PDT. Classic discovery contains 21 tools; OpenAI discovery contains 27 tools because progress operations use separate names and object schemas. Apply remains available on both routes.

Capture used ordinary OAuth authorization with PKCE and the dedicated directory-review fixture account. The callback issuer matched discovery. Invalid tokens received the protected-resource metadata challenge. Repeated old and current refresh tokens returned the same rotated pair during the grace window. Completed canary grants were revoked and their bearers then rejected. The snapshot contains public definitions only: no tokens, credentials, user records or private backend source.

This supplement records current OAuth discovery and refresh behavior. The separate hosted-contract-fixture.json remains the immutable deeper Apply/lifecycle baseline, including reviewed source and syntax pins. Its September capture must not be represented as current deployment proof. Current backend changes alter those security source hashes, so the old cross-repository verifier fails closed; this supplement does not waive it or claim a fresh verification of that deeper baseline.

No CLI runtime, plugin version, Apply schema or npm release changes are included. The .edu login gate remains in production audit mode.
