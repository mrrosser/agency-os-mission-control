# ExecPlan: Lead Run Phase 4 (Concurrency, Backoff, Escalation, Source Counters, Queue Panels)

## Goal
Ship the next reliability and operator-visibility upgrades:
1. Enforce max concurrent active runs per org.
2. Retry calendar scheduling with backoff before declaring no-slot.
3. Escalate stale open run alerts into telemetry triage.
4. Surface source diagnostics (fetched, filtered by score, with/without email).
5. Add queue lag + worker failure visibility in Operations.

## Scope
- Concurrency + quota updates in `lib/lead-runs/quotas.ts`:
  - Acquire/release active run slots per org.
  - Add active run data to quota summary.
  - Escalate stale open alerts into telemetry.
- Job lifecycle enforcement in:
  - `app/api/lead-runs/[runId]/jobs/route.ts`
  - `app/api/lead-runs/[runId]/jobs/worker/route.ts`
- Scheduling robustness:
  - Calendar retry/backoff and broadened slot search on retries in worker route.
- Source diagnostics:
  - Persist + return source diagnostics from `app/api/leads/source/route.ts`
  - Seed worker diagnostics from source diagnostics at job start.
- UI updates:
  - `components/operations/RunDiagnostics.tsx`
  - `app/dashboard/operations/page.tsx`

## Config
- Concurrency:
  - `LEAD_RUNS_MAX_ACTIVE_RUNS=3`
- Alert escalation:
  - `LEAD_RUN_ALERT_ESCALATION_MINUTES=30`
- Calendar retries:
  - `LEAD_RUNS_CALENDAR_MAX_ATTEMPTS=3`
  - `LEAD_RUNS_CALENDAR_BACKOFF_MS=1500`

## Data Model Notes
- `lead_run_org_quotas/{orgId}` adds:
  - `activeRunIds[]`
  - `activeRuns`
  - `maxActiveRuns`
- `lead_run_alerts/{orgId_runId}` may include:
  - `escalatedAt`
  - `escalationStatus`
  - `escalationRoute`
- `lead_runs/{runId}` adds:
  - `sourceDiagnostics` block from lead sourcing.
- `lead_runs/{runId}/jobs/default` diagnostics extends with:
  - source counters
  - calendar retry count

## Verification
- `npm test`
- `npm run build`
- `npm run test:pw`

## Run Local
1. Set env vars above in `.env.local`.
2. `npm install`
3. `npm run dev`
4. In Operations:
   - Start two to three runs; the fourth should 429 with active-run cap.
   - Validate queue lag, failed leads, and calendar retries update in diagnostics.
   - Leave an alert open past threshold and refresh alerts; escalation metadata should appear.

## Deploy
1. Set new env vars in target runtime.
2. Deploy existing Cloud Run/Firebase hosting pipeline.
3. Validate:
   - `/api/lead-runs/quota` includes `activeRuns` and `maxActiveRuns`
   - `/api/lead-runs/alerts` returns alerts with escalation fields when applicable
   - Operations dashboard shows new queue/failure/source counters
