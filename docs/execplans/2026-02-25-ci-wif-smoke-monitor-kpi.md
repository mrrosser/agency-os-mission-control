# ExecPlan: CI + WIF + Smoke + Rollback + KPI Surfacing (2026-02-25)

## Goal
Deliver the approved 1-5 hardening batch:
1) keep `npm test` as a CI gate with a dedicated test workflow,
2) migrate GitHub Actions Google auth to Workload Identity Federation (no JSON key files),
3) keep post-deploy smoke fail-closed on core authenticated lead-run routes,
4) add automated rollback hooks when production smoke fails,
5) surface weekly revenue KPI telemetry in dashboard/API with tests.

## Scope
- GitHub Actions workflow updates for deploy, preview, weekly KPI, telemetry triage, telemetry cleanup.
- Post-deploy smoke gate integration and rollback path in deploy workflow.
- New authenticated API route for latest weekly KPI snapshot.
- Dashboard wiring for weekly KPI cards.
- Tests for new API behavior and updated CI docs.

## Out of Scope
- Rewriting runtime queue architecture.
- Payment/provider business logic changes.
- Any secret material in repo.

## DoD Gates
- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`
- [x] Docs updated for local run + deploy/auth setup

## Local Run / Verify
- `npm ci`
- `npm run lint`
- `npm run test`
- `npm run build`

## Deploy Notes
- Main deploy workflow: `.github/workflows/firebase-hosting-merge.yml`
- Production smoke gate: `npm run test:postdeploy`
- Main deploy now uses preview-channel deploy + smoke + promote-to-live flow.
- If smoke fails, live remains unchanged because promotion is skipped.

## Progress
- [x] Added dedicated CI test workflow.
- [x] Replaced workflow JSON-key auth with WIF auth.
- [x] Added rollback automation step.
- [x] Added latest KPI API + dashboard surfacing.
- [x] Added/updated smoke tests.
