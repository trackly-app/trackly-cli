# Supported offline hosted generation

The ordinary hosted check still verifies the immutable historical fixture, or
requires its exact deployed backend merge when a backend checkout is supplied.
The separately registered H source can be checked offline:

```sh
TRACKLY_BACKEND_DIR=/absolute/path/to/close-ai \
  npm run test:hosted-contract -- --offline-candidate
```

Only backend HEAD `98d9e83a127892a7f1d13d40e4084a39fae0dc83` is supported by
this mode. Success is labeled `OFFLINE/UNDEPLOYED`; running that candidate
through the ordinary command fails. There is no expected-hash argument,
skip-deployment switch, automatic source capture, or unknown-source fallback.

`scripts/hosted-offline-generation.json` binds 57 source paths to exact Git
blobs, SHA-256 bytes, origin commits, the candidate's tree and ordered ancestry,
and historical counterparts where they existed. The verifier pins the registry
itself. Git replace refs, dirty source, a different HEAD, and altered fixtures
fail. The original fixture, skill lock, deployed `dded739` assertion, and five
unchanged resume-security hashes remain intact.

Captain source windows are close-ai#2434 comments5966927966,5967145128 and5967344651. The final window explicitly includes the inherited nine display-string substitutions; it permits verifier preparation only.

The generation adds expectations only for these inspected deltas:

- Native resume download shares capability validation, owned-document
  authorization, internal owner authentication and ambient-user removal with
  preview. The download owns an 8 KB URL-encoded parser with two parameters;
  both global parsers bypass only exact POST preview/download paths. Complete
  ordered global middleware ASTs retain all other reviewed carveouts.
- The inherited auth budget splits OAuth start/continuation legs from strict
  password/code paths. Its IP helper calls the verified client-IP resolver;
  that resolver runs before the limiters. The exact resolver and telemetry
  source are included. No new quota or authentication policy is introduced here.
- Plugin server descriptors and resume UI strings change “résumé” to “resume.”
  Only the two affected descriptor digests and the UI HTML AST expectation grow
  a current-generation alternative; all handler/schema locks remain enforced.
- Job brief adds aggregator employer identity and application URL projection,
  using the exact mapper source. Database source adds a dedicated maintenance
  connection and stops recreating two duplicate indexes.
- Profile service adds work-history handling, no-op suppression, locked-revision
  comparisons and consent-aware agent exports. Its catalog reader adds 32
  fields and the work-history schema; current sensitivity-map and source-byte
  expectations are explicit. Existing field classifications are preserved.
- H adds five hosted MCP tools and two exact helper declarations. Its five REST
  routes retain per-route authentication/access and authenticated owner
  derivation. The index locks the complete mount inventory and its immediate
  ordering behind the JobScout router and API-key resolver. Historical hosted
  and public-facade catalogs are untouched; the current hosted catalog grows
  only by these five named tools.

Run the actual full-verifier calibration and package suite with a local,
read-only backend repository containing the registered commits:

```sh
TRACKLY_HOSTED_GENERATION_TEST_BACKEND=/absolute/path/to/close-ai npm test
```

The test clones disposable source fixtures and runs the whole executable for
the positive plus wrong owner, wrong authorization owner, unprotected/shadowed
mounts, broad parser bypass, unknown bytes, altered inherited lock, wrong HEAD,
replaced ancestry, and historical-fixture mutation. Without the private source
repository, that integration test is explicitly skipped; fixture/unit results
alone are not current full-verifier acceptance.

Promotion is separate work. Keep CLI157 Draft until backend `trusted_live`,
exact source/merge ancestry and a real served descriptor/schema/security receipt
plus public OAuth/endpoint acceptance exist. This registry contains no runtime
receipt and cannot authorize CLI merge or publication. Owner #2434 retains the
expanded independent review, commit, review gate and captain handoff.
