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
- [ ] Scoped commit and draft PR.

## Progress

2026-10-07: recovered current cloud/Gmail evidence, confirmed missing state transition in deployed source, created isolated worktree from production commit, implemented bounded recovery and completed application validation. Root and independent agent review found no blocking source issue. Preparing the draft PR; the dependency audit prevents release readiness.

Run/deploy/rollback: [recovery guide](../warm-reconnect-expired-launch-review.md). Validation: [October 7 report](../reports/2026-10-07-expired-unsent-pilot-review.md).
