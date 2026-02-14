# ExecPlan: Lead Run Phase 3 (Queue Dispatch, Quotas, Channel Worker, Receipts UX)

## Goal
Ship the next reliability + operations upgrades:
1. Cloud Tasks-backed worker dispatch (with safe HTTP fallback)
2. Per-org daily run/lead quotas + failed-run alert documents
3. Background worker support for SMS/call/avatar channels with per-channel retry
4. Operations receipts drawer with links/status/latency
5. Operations visibility into telemetry triage issue links

## Scope
- Update job dispatcher in `lib/lead-runs/jobs.ts`:
  - prefer Cloud Tasks when queue env is configured
  - fallback to direct internal worker POST when unavailable
- Add org quota + alert logic in `lib/lead-runs/quotas.ts` and enforce in:
  - `app/api/lead-runs/[runId]/jobs/route.ts`
  - `app/api/lead-runs/[runId]/jobs/worker/route.ts`
- Extend worker channels in:
  - `app/api/lead-runs/[runId]/jobs/worker/route.ts`
  - new diagnostics counters in `lib/lead-runs/jobs.ts`
- Add UI enhancements in:
  - `components/operations/LeadReceiptDrawer.tsx`
  - `components/operations/LeadJourney.tsx`
  - `components/operations/RunDiagnostics.tsx`
  - `app/dashboard/operations/page.tsx`
- Add telemetry group read API:
  - `app/api/telemetry/groups/route.ts`

## Environment / Config
- Cloud Tasks dispatch (optional; if missing, HTTP fallback stays active):
  - `LEAD_RUNS_TASK_QUEUE`
  - `LEAD_RUNS_TASK_LOCATION`
  - `LEAD_RUNS_TASK_SERVICE_ACCOUNT` (optional but recommended for OIDC)
  - `LEAD_RUNS_TASK_DELAY_SECONDS` (optional)
  - `GOOGLE_CLOUD_PROJECT` (or existing project envs)
- Quotas / alerts:
  - `LEAD_RUNS_MAX_RUNS_PER_DAY` (default `30`)
  - `LEAD_RUNS_MAX_LEADS_PER_DAY` (default `400`)
  - `LEAD_RUN_FAILURE_ALERT_THRESHOLD` (default `2`)

## Data Model Updates
- `lead_runs/{runId}/jobs/default` adds:
  - `orgId`
  - `config.useSMS`
  - `config.useAvatar`
  - `config.useOutboundCall`
- New quota collection:
  - `lead_run_org_quotas/{orgId}`
- New alert collection:
  - `lead_run_alerts/{orgId_runId}`
- Existing action receipts continue under:
  - `lead_runs/{runId}/leads/{leadDocId}/actions/{actionId}`

## Verification Evidence
- `npm test` (all tests passing)
- `npm run build` (type/build passing)

## Run Local
1. `npm install`
2. `npm run dev`
3. In Operations:
   - Run a background lead run with SMS/call/avatar toggles
   - Open lead `Details` drawer in Lead Journey
   - Verify Error Triage section displays issue links when telemetry groups exist

## Deploy (Cloud Run / Firebase Hosting framework flow)
1. Ensure new env vars above are set in target environment
2. Merge to main and run existing deployment pipeline
3. Post-deploy checks:
   - `/api/health`
   - `/api/lead-runs/{runId}/jobs` start/resume
   - `/api/telemetry/groups?runId={runId}`
