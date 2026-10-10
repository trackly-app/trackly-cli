# Trackly release verification

This checklist is mandatory for every Trackly CLI upgrade. A release makes the
current Trackly tools available in its public packages and deployed MCP surfaces;
installation verification proves that the named environments are using it.
Release closeout requires both. Keep publication, installation and authenticated
browser readiness as separate states.

## Before publication

- Record the intended npm CLI version, MCP contract version, native Apply skill
  version, plugin version, plugin adaptation lock and any required harness pins.
  These identifiers belong to different packages and need not share a number.
- Run the repository CI checks: tests, dependency audit and audit policy, checked-in
  hosted contract, plugin submission preflight and package smoke test.
- When tools or schemas change, compare the final backend candidate with
  the test:hosted-contract npm script and TRACKLY_BACKEND_DIR set to its checkout.
  Verify complete tool names and input schemas, including the reviewed differences
  between local MCP, hosted MCP and the plugin facade. Equal tool counts alone
  do not establish parity; distinct facade allowlists must remain intact.
- Coordinate the CLI and backend owners and update cloud installer pins and their
  captured tool-contract fixtures through the normal reviewed PR workflow.

## Published artifacts and live tools

- Verify the exact merged commit, GitHub release, npm latest version, published
  tarball integrity and provenance attestations. Check successful npm and MCP
  Registry publication steps rather than relying only on a release tag.
- Inspect the published tarball, rather than only the source checkout. Verify
  CLI/server versions, dependency declarations against the source lock, MCP code
  and native skill contents. Boot
  the published MCP server and obtain the full paginated tools/list inventory.
  Compare tool names and input schemas against the intended release contract.
- Check the production hosted MCP and plugin facade with approved existing
  authentication. Verify their complete discoverable tools and schemas and the
  deployed backend contract. Source fixtures and unauthenticated HTTP challenges
  do not prove authenticated live discovery. Do not run application mutations or
  paid AI calls as release probes.
- Verify the plugin manifest and adaptation lock against the installed package.
  A newer Git marketplace package does not prove that a separately reviewed
  plugin catalog or connector listing has been updated. Record its actual
  submission, approval and publication state independently.

## Installation matrix

Record a fresh receipt for each target below. Include its account and environment
identity, timestamp with time zone, npm package/CLI version, supported Node
runtime, actual MCP server version, complete tool names and schema digest, native
skill version and file hashes, installed plugin version and lock hashes, and any
applicable harness version. Keep credentials and profile answers out of receipts.

| Target | Required evidence |
| --- | --- |
| M1 | Verify the actual application account and its installed package, native skills, plugin and MCP discovery; an SSH login to another account is insufficient. |
| M4 | Verify the installed package, native skills, plugin manager result and MCP discovery. |
| Conductor Cloud image | Verify the successful active build, exact merged installer source, pinned package/plugin versions and MCP schema checks. |
| Conductor retained homes | Verify each in-scope retained home separately; rebuilding the shared image does not update them. Enumerate any dormant or archived homes left unverified. |
| Current Codex Cloud | Verify the signed-in account, actual helper outputs, saved and published environment revision, then installation and MCP discovery in a restored workspace. A setup-chat success alone is insufficient. |

Use the client plugin manager to update installed plugins; never patch versioned
plugin caches. Verify all applicable clients that consume the package. Where a
client supports native skills instead of this plugin format, record that
difference and verify the native skill. A genuinely unsupported plugin manager,
missing authentication or unreachable environment is an explicit verification
gap, not a passing result. Preserve unrelated settings and report intentional
configuration changes separately from configuration preservation checks.

## Existing public users

An existing global npm install remains at its installed version until updated.
The supported local update sequence is:

~~~sh
npm install --global trackly-cli@latest
trackly --version
trackly agent setup --client both --skills-only
trackly agent doctor
~~~

The skills-only setup preserves existing MCP registration and authentication.
Users with one client can select codex or claude. Restart the configured local
MCP server or its client after updating, refresh discovery, and verify the new
server version and tools. A running old process keeps the old tool implementation.
Check the actual Node runtime against the package engines requirement.

For the official Git marketplace plugin, use the documented Codex plugin manager:

~~~sh
# Register the official marketplace once, if it is not already configured.
codex plugin marketplace add trackly-app/trackly-cli --ref main
codex plugin marketplace upgrade trackly-cli
codex plugin add trackly@trackly-cli --json
~~~

Verify the returned installed version and package hashes, then reload the client.
Other plugin catalogs follow their own supported update and approval lifecycle.
Hosted MCP users receive the deployed server implementation; reconnect or refresh
client discovery after a tool change and verify the intended authenticated surface.

## Closeout

Attach the release version set, published artifact evidence, live tool-contract
checks, installation matrix, changed-configuration checks and remaining gaps to
the release record. Every applicable row must pass before claiming global parity.
When only package publication is verified, report publication; when installations
are verified but live discovery is unavailable, report that narrower result.
An upgrade remains incomplete until required verification gaps are resolved.
