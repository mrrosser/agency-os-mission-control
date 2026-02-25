# ExecPlan: POS Worker Subagent (Backend Only)

Date: 2026-02-24  
Owner: Mission Control

## Goal
Add a deterministic POS worker layer that can be consumed by OpenClaw/Mission Control boards without changing the existing user-facing Mission Control UI.

## Scope
1. Deterministic stage pipeline for POS events: `source -> normalize -> policy -> execute -> reconcile`.
2. Idempotent action guardrails for event/action execution receipts.
3. Policy gates for side effects (default-off + approval path for high-risk actions).
4. Status/health API with queue lag, blocked, and dead-letter visibility.
5. Fail-safe retry + dead-letter behavior for worker claims.

## Deliverables
- [x] POS worker runtime library: `lib/revenue/pos-worker.ts`
- [x] Square webhook enqueue + inline completion integration: `app/api/webhooks/square/route.ts`
- [x] Worker task route: `POST /api/revenue/pos/worker-task`
- [x] Status route: `GET /api/revenue/pos/status`
- [x] Approval route: `POST /api/revenue/pos/approvals`
- [x] Control-plane integration for POS health/service card
- [x] Unit + smoke tests for helper logic and new routes
- [x] README + runbook updates

## Out Of Scope (this slice)
- Direct Square write API execution (invoice create/send/refund issue).  
  Current implementation writes deterministic outbox actions for controlled downstream execution.

## Verification Gates
- `npm run test:unit -- tests/unit/revenue-square.test.ts tests/unit/revenue-pos-worker.test.ts`
- `npm run test:smoke -- tests/smoke/webhooks-square-route.test.ts tests/smoke/revenue-pos-worker-task-route.test.ts tests/smoke/revenue-pos-status-route.test.ts tests/smoke/agents-control-plane-route.test.ts`
- `npm run lint`

## Rollback
- Revert new POS routes + worker library.
- Keep existing Square webhook lead-stage update path (already backward compatible).
