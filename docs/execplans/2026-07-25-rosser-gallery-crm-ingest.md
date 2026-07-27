# Rosser Gallery collector-lead CRM ingest

## Objective

Add a safe, retryable service-to-service receiver that projects allowlisted Rosser Gallery campaign leads into the existing Mission Control Firestore CRM without letting the public sender choose an owner, workspace, business unit, or CRM tags.

## Scope

- Strict versioned contract shared with the RNG website sender.
- Fail-closed bearer authentication from server environment.
- Transactional, payload-and-tenant-bound idempotency and daily create quota.
- Stable customer/timeline identifiers plus a durable tenant contact-identity map.
- Lead/timeline projection with purpose-scoped append-only consent evidence.
- Existing CRM list/timeline compatibility for the projected record.
- Unit and route smoke tests with a fake store/mocked external boundary.
- Local and Cloud Run configuration documentation.
- Versioned White Linen Night and Etsy launch browser-lead contracts on the same endpoint and person/receipt infrastructure.

Not in scope: production-traffic promotion without a separate readback, Secret Manager writes, production data migration, outbound email/SMS, Meta campaign activation, Square/Etsy mutation, provider commerce ingestion, or any campaign enablement. The approved release may create a tagged zero-traffic candidate and perform its authenticated non-writing readiness check.

## Design decisions

1. `userId` and `workspaceId` are both written so the existing LeadFlow view and workspace-scoped reconciler can see the same projected record.
2. A stable HMAC contact key maps normalized email plus workspace to one CRM customer. The first event safely bootstraps a single legacy random-ID customer; ambiguity fails closed, and later events use the durable mapping.
3. Receipt, identity, quota, customer, inquiry, and consent evidence are committed in one transaction. Exact receipt replay is free; changed payload or tenant route returns `409`.
4. Gallery consent is purpose scoped under `consentScopes.rosser_gallery_collector`; every submission has a deterministic append-only evidence record. Generic or RT Solutions consent is never inherited, relabeled, revoked, or overwritten.
5. `latest*`, current offer, contact, and next-action fields update only for the newest captured event. Delayed events still append history without regressing current state.
6. V1 pins top-level and nested attribution to The Braider Atlanta Meta campaign. V2 adds exact White Linen Night and Etsy lane/campaign namespaces, browser-lead event allowlists, and source/medium/content matrices. All versions enforce timestamp ordering and bounded age/future-skew windows.
7. Body size is capped at 32 KiB and the authenticated integration is capped at 500 new events per UTC day in a distributed Firestore transaction.
8. The collector-preview code remains receiver-local; no global Square/offer catalog or knowledge-pack behavior is changed.
9. Production currently reads Firestore because Paperclip is not configured. Configuration fails closed if Paperclip later becomes canonical without a separately approved PII-bearing mirror.
10. Logs contain operational identifiers and classification only, never contact fields, city, note, or credentials.
11. CRM tags are derived server-side, append-deduped with existing tags, and cannot be supplied by the sender. White Linen explicit collector intents and Etsy launch leads receive only their documented Gallery tags.
12. The shared browser receiver rejects check-ins, purchases, orders, refunds, and other provider events. Signed provider/server receivers remain separate.
13. Readiness reports only supported schema versions, campaign IDs, and lead-event names. It exposes no routing IDs, credentials, or feature state and does not imply sender or campaign activation.

## Progress

- [x] Release worktree `C:\CTO Projects\agency-os-rosser-crm-receiver-release` and branch `codex/rosser-crm-receiver-release-20260726` created from deployed PR-18 baseline `09b5abf`.
- [x] Contract, configuration, readiness route, and transactional projection implemented.
- [x] Security review blockers addressed: legacy dedupe, scoped consent, timestamp/touch pinning, delayed-event protection, body/quota limits, correlation fields, and note minimization.
- [x] Projected CRM reader updated to consume latest Gallery context and query the selected customer's timeline directly.
- [x] Shared synthetic fixture and environment template added.
- [x] Canonical routing resolved read-only from production Firestore: owner `fMsduRLGAQfk7BMFOe3N9kkIe8y2`, workspace `ws_cd43331c4b1648d0`.
- [x] Focused receiver/visibility suite rerun after hardening.
- [x] Critical WebSocket advisory removed with a compatible `websocket-driver@0.7.5` override; direct Next.js and ESLint config moved together to the patched `15.5.22` line.
- [x] Reproducible clean install, 37-test focused suite, and scoped lint passed on the patched dependency tree.
- [x] Patched production build completed successfully; the only warning is the inherited protobuf dynamic-import warning.
- [x] Staged-diff secret scan passed with no leaks.
- [x] Clean release commits attested; the multi-lane implementation commit is `080ca9b57f85c2bb727ac45a7f481e6c47d3ce7f`.
- [x] Tagged no-traffic candidate created and authenticated read-only readiness check completed. Exact revision promotion and rollback commands remain documented but were not run.
- [x] White Linen Night and Etsy launch v2 schemas added on the same endpoint without changing Atlanta v1.
- [x] Lane-specific receipt sources, server-owned tags, timeline actions, and lead-only event allowlists implemented.
- [x] Cross-lane customer dedupe, append-only Gallery consent, exact replay, attribution pinning, and forbidden provider-event tests added.
- [x] Reviewed, committed, and deployed the v2 extension as zero-traffic candidate `ssrleadflowreview-rosser-crm-lanes-20260727`; production remains on baseline revision `ssrleadflowreview-00264-xmm` at 100% traffic.

## Verification plan

```powershell
npm ci
npx vitest run tests/unit/rosser-gallery-collector-contract.test.ts `
  tests/unit/rosser-gallery-crm-config.test.ts `
  tests/unit/rosser-gallery-collector-ingest.test.ts `
  tests/unit/rosser-gallery-crm-visibility.test.ts `
  tests/smoke/rosser-gallery-collector-leads-route.test.ts
npx eslint app/api/integrations/rosser-gallery/collector-leads/route.ts `
  lib/crm/customer-memory.ts `
  lib/crm/rosser-gallery-collector-contract.ts `
  lib/crm/rosser-gallery-collector-ingest.ts `
  lib/crm/rosser-gallery-crm-config.ts `
  tests/unit/rosser-gallery-crm-visibility.test.ts
npm run build
npm audit --omit=dev --audit-level=high
gitleaks git --staged --redact --no-banner --no-color
```

External APIs and Firestore writes are mocked/faked in tests. Production Firestore
was queried read-only only to resolve tenant routing. The only external release
mutation was an approved preview build and zero-traffic candidate; no production
traffic promotion or write-bearing smoke was performed.

## Verification results

- `npm ci --ignore-scripts --prefer-offline --no-audit`: PASS, 863 packages installed from the regenerated lockfile.
- Resolved release gates: `next@15.5.22`, `eslint-config-next@15.5.22`, and overridden `websocket-driver@0.7.5`.
- Focused hardened receiver/visibility suite: PASS, 37 tests across 5 files.
- Scoped ESLint: PASS with zero findings.
- `npm run build`: PASS on Next.js `15.5.22`; 96 static pages generated and the collector receiver route is present in the final route manifest. One inherited protobuf dynamic-import warning remains.
- Staged-diff `gitleaks`: PASS; 97.64 KB scanned with no leaks.
- `npm audit --omit=dev`: 22 inherited findings remain (11 moderate, 11 high, 0 critical). The remaining high findings are constrained to upstream-incompatible Sharp/PostCSS ranges or build/outbound-client dependency paths; image optimization is disabled and attacker-controlled image processing is prohibited for this release. Follow-up lock/override cleanup is required, but the critical public-release blocker and direct Next.js advisories have been patched.
- Multi-lane receiver suite: PASS, 46 tests across 5 files after the White Linen and Etsy v2 extension.
- Scoped ESLint and TypeScript `--noEmit`: PASS with zero findings.
- Production Next.js build: PASS; only the inherited protobuf dynamic-import warning remains.
- Firebase review channel: `rosser-crm-lanes-20260727`, URL `https://leadflow-review--rosser-crm-lanes-20260727-4vba1rme.web.app`, expires 2026-08-03 02:55:38 America/Chicago.
- Firebase code revision: `ssrleadflowreview-00391-geh`.
- Secret-bound candidate: `ssrleadflowreview-rosser-crm-lanes-20260727`, tagged at `https://rosser-crm-candidate---ssrleadflowreview-gdyt2qma6a-uc.a.run.app`, with zero production traffic.
- Authenticated non-writing readiness: PASS for schema versions 1 and 2 and all three campaign IDs; correlation ID `rng-candidate-lanes-readiness-20260727-0001`.
- Production traffic readback: unchanged at 100% on `ssrleadflowreview-00264-xmm`.

## Rollback

Remove or stop routing traffic to `/api/integrations/rosser-gallery/collector-leads`, then revert this scoped change. Existing Firestore records are retained; no automated deletion is part of rollback.
