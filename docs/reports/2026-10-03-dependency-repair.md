# Dependency repair for the dedicated sender release

## Scope and current validation status

This isolates dependency repair needed to pass the existing high-severity npm audit gate for PR #53. No audit threshold, workflow, application authorization gate, runtime configuration or credential changes are included. Local release validation is recorded below. This document does not assert production deployment.

The earlier local zero-finding audit was superseded by the official registry and GitHub result (12 high and 14 moderate package entries). The cause of that discrepancy was not established. Explicit official-registry reproduction rules out an operating-system difference.

## Dependency changes and boundaries

- `@fastify/busboy` 3.2.0 -> 3.2.2, within Firebase Admin's existing range. Its app path is Firebase Admin's multipart response parser (`Dicer`), not an inbound upload route. Regression checks must cover hostile boundary/header input and valid response completion.
- Axios 1.19.0 -> 1.20.0, within Twilio's existing range. The app uses generated Twilio endpoints after authentication, budget and DNC gates; request data is serialized into the body. The SDK's explicit method, proxy and redirect behavior must remain intact. No message or call is sent during verification.
- `brace-expansion` 1.1.18 -> 1.1.21 and both 5.0.9 copies -> 5.0.12, within their parents' existing ranges.
- All `@grpc/grpc-js` copies -> 1.14.5 by explicit override. This deliberately exceeds Firebase JS Firestore's `~1.9.0` constraint; it is justified by tracing the exact public client APIs and must pass credential-free loopback SDK integration tests. Firestore's own proto-loader range remains unchanged; gRPC retains its separate internal proto-loader. No experimental resolver/load-balancer API is used by these consumers.
- Only `@next/eslint-plugin-next@15.5.25` replaces `fast-glob` with the official `tinyglobby@0.2.17` package. The lock resolves the real tinyglobby tarball and removes `braces`/`micromatch` entirely. This is NOT a general fast-glob compatibility claim.

## Explicit Next lint configuration boundary

The Next plugin's sole glob consumer is `get-root-dirs.js`; it expands a configured `settings.next.rootDir`. This repository uses the default single application root, where the plugin directly returns `context.cwd` and never calls glob. All 21 currently enabled Next rules and their existing severities remain enabled, including `no-html-link-for-pages` at error severity.

Tinyglobby differs on directory expansion, absolute path output, advanced brace patterns and some filesystem cases. `eslint.config.mjs` therefore checks the complete final configuration with `assertDefaultNextRootDirectory` and rejects any custom `settings.next.rootDir`, even an explicitly undefined value. It fails with a migration message rather than silently changing matching behavior. Future custom or monorepo roots require a reviewed migration before use. External configurations bypassing this repository's configuration are outside this constrained replacement contract.

Tests must verify the effective rule configurations, actual internal-link rejection and allowed Link behavior, the root-directory guard, and the version-scoped dependency graph. Revisit/remove this temporary override when the upstream Next lint dependency no longer includes the unpatched parser. Do not broaden the alias to other consumers.

## Exposure and remaining findings

No current application route was found that authenticates clients through gRPC `getAuthContext`; the affected libraries are outbound clients. No currently reachable request-to-exploit path was demonstrated for the investigated high advisories. This bounded observation does not justify an exception, and none is applied.

The candidate public audit reports zero high/critical and 16 moderate package entries. The remaining five distinct root advisories concern `qs`, `uuid`, `@humanfs/node` and `@vitest/mocker`. Two additional moderate parent entries (`firebase-frameworks` and `firebase-functions`) arise through the already-present Firebase Admin chain; no new root advisory was introduced. These findings are retained and are below the repository's unchanged high-severity release threshold, not claimed fixed. Do not use npm's suggested major downgrades or broad force upgrade to hide them.

## Verification and rollback

Focused security/compatibility checks, full tests, lint, production build, public-registry audit and secret/whitespace scans are required before this repair enters the protected release. Loopback tests use synthetic data and no live credentials or provider endpoints. Exact results will be recorded below after completion.

Before merge, verify zero stored pilots and preserve work-account bindings/defaults and the existing provider-send switch. The existing main workflow captures a fresh rollback target before its controlled candidate promotion. Revert the dependency repair commit to restore the previous graph/config if needed; that also restores the audit blocker, so it is not an alternative deployment path. The RT contact site is separately published and untouched by this repair.

## Primary sources

- Busboy: https://github.com/advisories/GHSA-xjh9-v7x6-24jw and https://github.com/advisories/GHSA-x8mw-p69m-v3mx
- gRPC: https://github.com/advisories/GHSA-m9gg-hp2v-232j and https://github.com/grpc/grpc-node/releases/tag/@grpc%2Fgrpc-js@1.14.5
- Braces: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- Tinyglobby's documented differences: https://superchupu.dev/tinyglobby/comparison
- Full original audit and exact other advisory IDs are retained in the parent workspace `rt-release-public-registry-audit-20261003.json`; candidate report: `rt-dependency-candidate-audit-20261003.json`.

## HTTP-specific validation limit

The additional HTTP dependency test agent was stopped by automatic cybersecurity content filtering. A second assignment limited to ordinary valid-response/request compatibility was also stopped; neither test task completed, and no result is claimed. The blocked payload work was not retried through another agent or tool. Existing repository Twilio route/worker tests remain part of the full suite. Installed Busboy source was inspected against the official fixes: stream-search occurrence storage is Uint16Array and header maps are Object.create(null). The official patched package identities/integrities and fresh registry audit are retained. This is a package-fix/source verification substitute, not a claim that local malformed-multipart or real Twilio transport security regressions passed.

## Candidate verification results

- Fresh pinned install completed with lifecycle scripts disabled. No source/workflow changes were required for installation.
- `npm audit --audit-level=high --registry=https://registry.npmjs.org`: PASS, exit 0; zero high/critical, 16 moderate entries retained.
- `npm run lint`: PASS, zero errors and the same three existing warnings.
- Focused actual Firebase Node SDK loopback suite: 8/8 PASS; transaction reads/commits, unary/stream errors, duplex write acknowledgments/errors, watch data/end, SDK stub closure, generated readable cancellation and channel shutdown. Scoped ESLint passed.
- Focused lint boundary suite: 10/10 PASS, preserving all 21 enabled Next rules and real internal-link rejection, with scoped lint PASS.
- Complete unit/smoke suite: 1,278/1,278 PASS across 241 files.
- `npm run build`: PASS, including production compilation and its typecheck.
- A separate full TypeScript check found that the prior provider-flag test fixture lacked required `NODE_ENV`. The fixture now explicitly uses `NODE_ENV: "test"`; no production behavior changed. Final standalone typecheck/focused rerun and independent review are recorded at the final checkpoint below.
- gRPC tests cover plaintext loopback transport, not live production TLS/cloud authentication. No production credentials were used.

## Final local checkpoint

Standalone `tsc --noEmit` PASS. Final focused rerun 26/26 PASS across the gRPC, lint boundary and provider-flag suites. Fresh independent read-only candidate review found no consequential issues and independently confirmed all installed gRPC consumers resolve 1.14.5, Firestore's proto-loader remains 0.7.15, scoped alias provenance/removal, unchanged gates and 26/26 focused tests. The reviewer retained the TLS/cloud-auth and direct HTTP transport proof limits above. Whitespace and staged Gitleaks scans passed. No live action is implied by these local results.
