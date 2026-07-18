# Structured review: PR #73

Reviewed commit: `7cba0dd`

Scope: publish Trackly Apply skill 4.1 and protocol 3.1 support, add the value-free beta evidence command/MCP tool, guarantee a patched Hono dependency for consumers, and prevent pre-evidence runs from resuming under the stronger contract.

## Review coverage

- Correctness: evidence query bounds, response rendering, protocol/run compatibility, and lifecycle sequencing.
- Security: direct Hono resolution, credential transport, redacted evidence, resume proof, and manual-submit boundaries.
- Agent-native behavior: hosted/local tool parity, MCP prompt sequencing, current-run preservation, and fail-closed compatibility.
- Distribution: npm package contents, clean-home skill setup, Codex/Claude links, and doctor compatibility.
- Documentation and versioning: CLI 0.7.1, skill 4.1.0, protocol 3.1.0, server manifest, changelog, and tool tables.

## Findings resolved

1. P1: the MCP prompt initially required `run.protocolVersion` before starting a brand-new run, even though the value exists only after `trackly_start_apply_run` returns.
   - Resolved by sequencing the gate: validate the fetched protocol before creation, validate the returned run version after creation, and validate the stored version before resumption. The regression test asserts both stages.
2. P1: a pre-evidence protocol 3.0 run could be interpreted as resumable after the server upgraded.
   - Resolved in both the public skill and MCP prompt: preserve the old run, block it through the supported lifecycle when possible, and never replace it silently.
3. P2: the evidence query could lose caller-supplied bounds or depend on a newer `URLSearchParams.size` runtime.
   - Resolved with explicit string serialization and contract tests.
4. P2: hosted/local MCP schemas exposed abstract arrays rather than concrete versioned ATS scenario and browser-surface values.
   - Resolved by making the contract own the exact enums and testing local parity.

## Dependency hardening

- `hono` is now a direct published dependency at `^4.12.30`; consumer installs no longer rely on root-only npm overrides.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm pack --dry-run`: the 0.7.1 tarball contains the expected 18 public files and no personal profile data.

## Independent review result

- Structured correctness, security, and agent-native review: clean after the prompt-sequencing fix.
- GitHub Codex findings were addressed and their threads resolved.
- CodeRabbit reported its temporary review limit at July 17, 2026 8:47 PM PDT. A retrigger at 9:50 PM PDT returned “review finished” but stated that incremental commits were not re-reviewed, so it is documented as quota-dead rather than treated as substantive coverage.
- The configured Claude workflow reported an authentication failure and is likewise not treated as review coverage.

## Verification

- CLI suite: 161/161 passed.
- Hosted/local Apply MCP contract parity: protocol 3.1.0 matched.
- npm audit: zero vulnerabilities.
- npm publish dry run: passed.
- `git diff --check`: passed.

Verdict: Ready to merge under the repository's documented reviewer-quota exception after current CI completes.
