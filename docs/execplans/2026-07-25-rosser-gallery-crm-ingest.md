# Rosser Gallery collector-lead CRM ingest

## Objective

Add a safe, retryable service-to-service receiver that projects Rosser Gallery collector requests into the existing Mission Control Firestore CRM without letting the public sender choose an owner, workspace, or business unit.

## Scope

- Strict versioned contract shared with the RNG website sender.
- Fail-closed bearer authentication from server environment.
- Transactional, payload-and-tenant-bound idempotency and daily create quota.
- Stable customer/timeline identifiers plus a durable tenant contact-identity map.
- Lead/timeline projection with purpose-scoped append-only consent evidence.
- Existing CRM list/timeline compatibility for the projected record.
- Unit and route smoke tests with a fake store/mocked external boundary.
- Local and Cloud Run configuration documentation.

Not in scope: production-traffic promotion without a separate readback, Secret Manager writes, production data migration, outbound email/SMS, Meta campaign activation, or Square catalog mutation. The approved release may create a tagged zero-traffic candidate and perform its authenticated non-writing readiness check.

## Design decisions

1. `userId` and `workspaceId` are both written so the existing LeadFlow view and workspace-scoped reconciler can see the same projected record.
2. A stable HMAC contact key maps normalized email plus workspace to one CRM customer. The first event safely bootstraps a single legacy random-ID customer; ambiguity fails closed, and later events use the durable mapping.
3. Receipt, identity, quota, customer, inquiry, and consent evidence are committed in one transaction. Exact receipt replay is free; changed payload or tenant route returns `409`.
4. Gallery consent is purpose scoped under `consentScopes.rosser_gallery_collector`; every submission has a deterministic append-only evidence record. Generic or RT Solutions consent is never inherited, relabeled, revoked, or overwritten.
5. `latest*`, current offer, contact, and next-action fields update only for the newest captured event. Delayed events still append history without regressing current state.
6. V1 pins top-level and nested attribution to The Braider Atlanta Meta campaign, enforces timestamp ordering, and accepts delivery only within bounded age/future-skew windows.
7. Body size is capped at 32 KiB and the authenticated integration is capped at 500 new events per UTC day in a distributed Firestore transaction.
8. The collector-preview code remains receiver-local; no global Square/offer catalog or knowledge-pack behavior is changed.
9. Production currently reads Firestore because Paperclip is not configured. Configuration fails closed if Paperclip later becomes canonical without a separately approved PII-bearing mirror.
10. Logs contain operational identifiers and classification only, never contact fields, city, note, or credentials.

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
- [ ] Clean commit attestation and approved zero-traffic candidate readiness check.
- [x] Tagged no-traffic candidate, authenticated read-only smoke, exact revision promotion, and rollback commands documented. None were run.

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
was queried read-only only to resolve tenant routing. No deploy command will be run
as part of this implementation.

## Verification results

- `npm ci --ignore-scripts --prefer-offline --no-audit`: PASS, 863 packages installed from the regenerated lockfile.
- Resolved release gates: `next@15.5.22`, `eslint-config-next@15.5.22`, and overridden `websocket-driver@0.7.5`.
- Focused hardened receiver/visibility suite: PASS, 37 tests across 5 files.
- Scoped ESLint: PASS with zero findings.
- `npm run build`: PASS on Next.js `15.5.22`; 96 static pages generated and the collector receiver route is present in the final route manifest. One inherited protobuf dynamic-import warning remains.
- Staged-diff `gitleaks`: PASS; 97.64 KB scanned with no leaks.
- `npm audit --omit=dev`: 22 inherited findings remain (11 moderate, 11 high, 0 critical). The remaining high findings are constrained to upstream-incompatible Sharp/PostCSS ranges or build/outbound-client dependency paths; image optimization is disabled and attacker-controlled image processing is prohibited for this release. Follow-up lock/override cleanup is required, but the critical public-release blocker and direct Next.js advisories have been patched.

## Rollback

Remove or stop routing traffic to `/api/integrations/rosser-gallery/collector-leads`, then revert this scoped change. Existing Firestore records are retained; no automated deletion is part of rollback.
