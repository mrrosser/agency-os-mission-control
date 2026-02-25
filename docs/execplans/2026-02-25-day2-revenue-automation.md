# ExecPlan: Day 2 Revenue Automation Service

Date: 2026-02-25  
Owner: Mission Control

## Scope
- Add Day 2 revenue automation routes (`/api/revenue/day2`, `/api/revenue/day2/worker-task`).
- Wire worker auth token with Day 2 token + Day 1 fallback.
- Add local run/deploy scheduler scripts and runbook docs.
- Add smoke + unit tests for Day 2 behavior.

## Definition of done
- [x] Day 2 authenticated route implemented and validated.
- [x] Day 2 worker-task route implemented with token auth + fallback.
- [x] Local runner + scheduler setup scripts added for Linux + PowerShell.
- [x] Runbook and plan docs updated with local/deploy guidance.
- [x] Unit and smoke tests added for new Day 2 flow.

## Notes
- Day 2 loop keeps approval-first enforcement enabled by default (`requireApprovalGates=true`).
- Worker-task token fallback supports faster rollout when Day 1 token is already in Secret Manager.
