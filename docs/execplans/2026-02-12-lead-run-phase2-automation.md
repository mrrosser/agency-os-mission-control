# ExecPlan: Lead Run Phase 2 (Receipts Viewer, Timezone Scheduling, Background Jobs, Draft-First, Triage UX)

## Goal
Deliver the next reliability/ops improvements requested for Mission Control:
1. Receipt viewer that survives refresh
2. Server-side slot generation with timezone support
3. Durable background lead-run processing with pause/resume/retry
4. Per-template draft-first outreach mode
5. User-facing telemetry reporting hook tied to existing triage pipeline

## Scope
- Add receipts read API under `lead_runs/{runId}` and wire Ops UI to load prior runs.
- Update `/api/calendar/schedule` to accept server-side slot search (`slotSearch`) and generate candidates in API.
- Add Firestore-backed lead-run job APIs + worker endpoint:
  - `POST/GET /api/lead-runs/{runId}/jobs`
  - `POST /api/lead-runs/{runId}/jobs/worker`
- Add `draftFirst` to lead templates and outreach execution path.
- Add manual error-report UX in Operations tied to `/api/telemetry/error`.

## Out of Scope
- Auto-fix PR generation/auto-merge for telemetry findings.
- Cloud Tasks/managed queue migration (current worker loops via self-triggering HTTP).
- Full parity of all advanced channels (avatar/voice/SMS) in background worker path.

## Data Model
- Lead job state lives in:
  - `lead_runs/{runId}/jobs/default`
- Job document stores:
  - `status`, `nextIndex`, `totalLeads`, `diagnostics`, `attemptsByLead`, `workerToken`, `config`
- Existing action receipts remain:
  - `lead_runs/{runId}/leads/{leadDocId}/actions/{actionId}`

## Rollout Notes
- Backward compatible for current clients:
  - `/api/calendar/schedule` still accepts `candidateStarts`.
  - New clients can send `slotSearch`.
- Background worker is no-secrets-in-repo:
  - Worker auth uses per-job random token stored in Firestore.

## Verification
- Unit tests:
  - timezone slot generation utility
- Smoke tests:
  - templates route (including `draftFirst`)
  - lead-run receipts route
  - lead-run jobs route
- Full checks:
  - `npm test`
  - `npm run build`

## Run Local
1. `npm install`
2. `npm run dev`
3. Open Operations page and:
   - Start a foreground run
   - Start a background run
   - Pause/resume background run
   - Reload page and use run ID loader

## Deploy (Cloud Run via Firebase Hosting frameworks)
1. Push branch to GitHub and merge to `main`
2. Existing GitHub Actions deployment pipeline publishes new build
3. Verify:
   - `https://leadflow-review.web.app/api/health`
   - Ops page run + receipts + background controls

