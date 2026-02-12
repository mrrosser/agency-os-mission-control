# ExecPlan: Lead Run Reliability + Auditability (2026-02-12)

## Goal
Increase lead-run reliability and debuggability by reducing client-side orchestration, preventing "time conflict -> skip" drop-offs, and persisting per-lead action receipts so users can verify what happened (calendar/email/drive/etc).

## Scope
- Calendar booking: move slot search + booking to a single server endpoint; add fallback behavior when no slot is found.
- Receipts: persist per-lead action receipts (calendar, Gmail, Drive) under the existing `lead_runs/{runId}/leads/{leadDocId}` tree.
- Dry run: allow running the pipeline without side effects, while still generating scripts/content and writing "simulated" receipts.
- Diagnostics: surface counts + rejection reasons in the Operations UI (sourced vs filtered vs processed, no email, no slot, drafted, etc).
- Tests: unit tests for availability slot selection logic; smoke-level verification of core routes (mock external APIs).

## Out of Scope (this iteration)
- Moving the entire lead-run orchestration server-side (single "run" endpoint).
- Full per-action retries/backoff/queueing (Inngest/Cloud Tasks).
- Multi-user org RBAC and role-based limits beyond existing Firebase auth.

## Plan
1) Calendar: add `/api/calendar/schedule` that accepts candidate slots and creates the first available meeting (idempotent for successful creates).
2) Receipts: introduce server-only receipt writer and record receipts from Calendar/Gmail/Drive routes when `runId + leadDocId` is provided.
3) Dry run: add a UI toggle and plumb `dryRun` through the schedule/send/create-folder flows, returning simulated receipts.
4) Diagnostics: add an Operations diagnostics panel (counts + rejection reasons) and wire it to runtime state.
5) Fallback booking: when no slot is found, expand windows and/or create a Gmail draft requesting availability (no silent skips).

## Risks & Mitigations
- Time zone drift (server vs browser): keep candidate slot generation client-side for now; server only selects/creates from provided candidates.
- Idempotency over-caching "no slot": represent "no slot" as a 409 error to avoid recording idempotency entries.
- Accidental side effects: dry-run mode enforced server-side for side-effect endpoints.

## Test Plan
- `npm test` (unit tests)
- Manual: run lead engine in `dryRun=true` and verify receipts are written as simulated; then run `dryRun=false` and verify:
  - Calendar event exists with correct attendee/Meet link
  - Gmail sent (or draft created on fallback)
  - Drive folder created

## Rollback
Revert commits touching the new schedule endpoint + receipt writer + Operations UI wiring, then redeploy via GitHub Actions.

