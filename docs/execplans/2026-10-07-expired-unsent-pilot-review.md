# Return an expired, never-dispatched pilot to review

## Problem and scope

The original five-person pilot is `launch_requested`, its 24-hour approval expired, and read-only cloud/provider evidence shows no executor, delivery or invitation records. Existing approval rejects this status. Add an owner-only, idempotent application transition back to review for this precise state. Keep the same pilot, fingerprints, recipients and active campaign lock. Require a fresh normal approval and launch afterwards; recovery itself authorizes and sends nothing.

Base: production merge `5eedcb94df79cedf4f70be1c9d185bdb0e3c4c8f`, isolated branch `codex/crm-expired-pilot-review-20261007`. Canonical working tree is dirty and untouched. Existing dependencies reused after confirming the lock hash matches. Scope now includes a scoped commit and draft PR for review; no direct database repair, live operation, send, merge or deployment.

## Design

- Protected `POST /api/crm/warm-reconnect/pilots/[pilotId]/return-to-review`, Firebase authentication and existing owner/workspace checks, strict bounded JSON and idempotency header.
- Bind old approval ID, all three fingerprints and operator reason. Require finite expired approval on a launched exact-five pilot; recomputed artifact fingerprints must match.
- Inside the existing pilot transaction, read the pilot, operation event, owned active lock, executor, any delivery receipt and all five deterministic invitation-ledger records. Reject any execution evidence, including empty/malformed/unknown/previously released records.
- The dispatcher reads the same pilot and writes executor/receipt/ledger in its transaction. Reading these documents and writing the pilot establishes the Firestore conflict boundary: only pristine recovery or dispatcher claim can commit. A retry rechecks all guards.
- Set `needs_campaign_approval`, clear current approval/launch authority and rebuild pending gates. Preserve previous approval and launch time in the immutable operation event. Never modify the campaign lock or execution evidence.
- Add a UI action labeled “Check and return to review,” with a reason and clear no-send effect. Availability is provisional; server execution evidence is authoritative.

## Validation

- [x] Unit: expiration/status/fingerprint/approval identity, evidence absence, unexpected receipts, ledger evidence, idempotency/conflict/race handling and unchanged lock/content (24 new cases).
- [x] Smoke: auth, owner repository routing, bounded strict body, query/header rejection, no-store responses and no provider action (12 new cases).
- [x] Existing activation/executor and UI suites; full unit/smoke: 1,804 tests / 257 files passed. Lint: zero errors/two unchanged warnings. TypeScript and production build passed.
- [x] Dependency scan completed against the official registry, but the release gate FAILED: unchanged lock has three critical, three high and seventeen moderate advisories. No dependency changes or exception.
- [x] Run/deploy/recovery and rollback guide; exact original five/content handoff kept in private workspace. No production application.
- [x] Final scoped secret/whitespace scan passed with no findings.
- [x] Scoped commit and [draft PR #60](https://github.com/mrrosser/agency-os-mission-control/pull/60); no merge or deployment.

## Progress

2026-10-07: recovered current cloud/Gmail evidence, confirmed missing state transition in deployed source, created isolated worktree from production commit, implemented bounded recovery and completed application validation. Root and independent agent review found no blocking source issue. Published scoped implementation commit `c3f5d6f6a695c55d7217ff2e3b41b2f1ffb6f8ca` in draft PR #60; the dependency audit prevents release readiness. The deployed application and live pilot remain unchanged.

Run/deploy/rollback: [recovery guide](../warm-reconnect-expired-launch-review.md). Validation: [October 7 report](../reports/2026-10-07-expired-unsent-pilot-review.md).

## Authorized dependency repair follow-up

Marcus explicitly requested fixing the CRM release blocker. Continue on PR #60 without changing campaign source, approval gates, provider authority or existing evidence. No merge/deployment/live recovery/send until the updated result is reviewed by the root agent.

- [x] Reproduce current official-registry audit: three critical/four high/sixteen moderate. Verify upstream advisories and patched releases.
- [x] Upgrade sharp 0.35.4 to 0.35.5; preserve the existing shared sharp override. Update compatible transitive proxy-addr to 2.0.8 and source-map-js to 1.2.2.
- [x] Upgrade the development-only runner to Vitest 4.1.11, the patched 4.x release. It removes the vulnerable Tinypool dependency and fixes mocker path traversal. Explicitly pin existing Vite 7.3.6; preserve constructor fixture results, all assertions and explicit restoration, with per-test call-history cleanup configured.
- [x] Safely detach only this worktree's shared node_modules junction; create an owned installation. Preserve other worktrees' dependencies. Reviewed lock changes and Node 22 compatibility. Fresh audit: zero high/critical, fifteen moderate.
- [x] Four dependency runtime checks and complete unit/smoke suite: 1,808 tests / 258 files passed. Production build, TypeScript and lint passed; official-registry audit zero high/critical, fifteen moderate. Existing lint guard passed with its unchanged timeout after the final run removed check contention. All assertions preserved.
- [x] Prepare current scoped reports, guide and PR #60 update with upstream references, fresh validation and source preservation evidence. Publication and CI receipts are retained in the external handoff manifest; root reviews the update before any merge/deployment/live action.
- [ ] Final publication handoff: scoped secrets/whitespace scan, commit/push, and current-head protected CI readback. No release or live campaign authority is granted by this checklist.

Official references: [sharp 0.35.5 advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [proxy-addr 2.0.8 advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [source-map-js 1.2.2 advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [Tinypool 2.1.2 advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), [Vitest 4.1.11 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11). Earlier audit results remain historical evidence.
