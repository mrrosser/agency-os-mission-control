# Runbook: Revenue Sync + KPI Automation

Date: 2026-02-24
Owner: Mission Control

## 1) Square Webhook -> POS Worker + Lead Stage Update

### Endpoint
- `POST /api/webhooks/square`

### Required env
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_DEFAULT_UID` (fallback when payload does not include uid metadata)
- Optional: `SQUARE_WEBHOOK_NOTIFICATION_URL` (recommended in production so signature validation uses the exact public URL)
- Shared unattended-worker identity:
  - `REVENUE_AUTOMATION_UID` (server-side Firebase identity; callers cannot substitute it)
  - `REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL` (exact dedicated service account)
  - `REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE` (exact HTTPS Cloud Run service origin)
- Optional POS policy flags:
  - `POS_WORKER_ALLOW_SIDE_EFFECTS` (default `false`)
  - `POS_WORKER_AUTO_APPROVE_LOW_RISK` (default `true`)
  - `POS_WORKER_REQUIRE_APPROVAL_FOR_HIGH_RISK` (default `true`)
  - `POS_WORKER_MAX_ATTEMPTS` (default `5`)
  - `POS_WORKER_EXECUTE_OUTBOX` (default `false`; set to `true` to process queued outbox actions)
  - `POS_WORKER_OUTBOX_MAX_ATTEMPTS` (default `5`)

### Behavior
- Verifies `x-square-hmacsha256-signature` using Square HMAC-SHA256 (`notification_url + raw_body`).
- Accepts allowlisted Square families: `PAYMENT.*`, `INVOICE.*`, `REFUND.*`, `ORDER.*`.
- Queues deterministic POS worker events in `identities/{uid}/pos_worker_events/{eventId}`.
- Resolves `offerCode` from completed payment payloads and updates matching lead to `pipelineStage=deposit_received` (idempotent by `event_id`).
- Records each event in Firestore `square_webhook_events` for replay detection/audit.
- Writes deterministic side-effect outbox actions to `identities/{uid}/pos_worker_outbox/*` when policy allows.
- Optional outbox execution stage (when `POS_WORKER_EXECUTE_OUTBOX=true`) converts queued outbox rows into deterministic task docs in `identities/{uid}/pos_worker_tasks/*` with idempotent receipts.

### POS worker routes
- Status (auth): `GET /api/revenue/pos/status`
- Worker task (Google OIDC): `POST /api/revenue/pos/worker-task`
- High-risk approval gate (auth): `POST /api/revenue/pos/approvals`

### Cloud Run OIDC configuration (example)
```powershell
gcloud run services update mission-control `
  --region us-central1 `
  --set-env-vars "REVENUE_AUTOMATION_UID=YOUR_FIREBASE_UID,REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL=revenue-automation-scheduler@YOUR_PROJECT.iam.gserviceaccount.com,REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE=https://YOUR_SERVICE.run.app"
```

Keep `SQUARE_WEBHOOK_SIGNATURE_KEY` in Secret Manager. Do not place the Square secret or any worker token in `--set-env-vars`, Scheduler headers, repository variables, or workflow files.

### Square console setup
- Event destination URL must be the same public URL used in `SQUARE_WEBHOOK_NOTIFICATION_URL`.
- Subscribe to required POS event families (`PAYMENT`, `INVOICE`, `REFUND`, `ORDER`).
- Include metadata where possible: `uid`, `offerCode`, `leadDocId` (or `leadId`).

### POS worker invocation (example)
```powershell
$identityToken = gcloud auth print-identity-token `
  --impersonate-service-account "revenue-automation-scheduler@$env:GCP_PROJECT_ID.iam.gserviceaccount.com" `
  --audiences "$env:REVENUE_AUTOMATION_SERVICE_URL"
try {
  curl -X POST "$env:REVENUE_AUTOMATION_SERVICE_URL/api/revenue/pos/worker-task" `
    -H "Authorization: Bearer $identityToken" `
    -H "Content-Type: application/json" `
    -H "x-correlation-id: revenue-pos-manual-$([Guid]::NewGuid().ToString('N'))" `
    -d "{\"limit\":25,\"executeOutbox\":true,\"outboxLimit\":25}"
} finally {
  Remove-Variable identityToken -ErrorAction SilentlyContinue
}
```

The production `revenue-pos-worker-loop` job uses the same exact service account and Cloud Run origin through Cloud Scheduler OIDC. Its request body omits `uid`; `REVENUE_AUTOMATION_UID` is the sole worker identity source.

## 2) Mission Control -> AI_HELL_MARY Nightly Sync

### Command
```powershell
node scripts/sync-ai-hell-mary.mjs --target-root "C:\CTO Projects\AI_HELL_MARY"
```

### Synced artifacts
- `please-review/from-root/config-templates/knowledge-pack.v2.json`
- `docs/plans/2026-02-24-square-catalog-import.csv`
- `docs/plans/2026-02-24-weekly-kpi-loop.md`
- `docs/execplans/2026-02-24-dual-business-revenue-activation.md`

Target output path:
- `C:\CTO Projects\AI_HELL_MARY\docs\generated\mission-control\*`

### Windows nightly schedule (example 2:10 AM local)
```powershell
schtasks /Create /TN "MissionControl-AIHellMary-Sync" /SC DAILY /ST 02:10 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\CTO Projects\agency-os-mission-control\scripts\sync-ai-hell-mary-nightly.ps1\"" /F
```

## 3) Weekly KPI Rollup (Backend, no UI dependency)

### Routes
- Manual (auth): `POST /api/revenue/kpi/weekly`
- Scheduler/worker: `POST /api/revenue/kpi/weekly/worker-task`

### Worker auth env
- `REVENUE_AUTOMATION_UID`
- `REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL`
- `REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE`

### Worker request body
```json
{
  "timeZone": "America/Chicago",
  "weekStartDate": "2026-02-23"
}
```

### Output
- Writes weekly report docs under:
  - `identities/{uid}/revenue_kpi_reports/{weekStartDate}`
  - `identities/{uid}/revenue_kpi_reports/latest`
- Report payload includes:
  - `outcomeGates.gates[]` with canonical gate statuses (`pass|warn|fail`)
  - `outcomeGates.summary` with pass/warn/fail counts
  - `outcomeGates.criticalGateFailures` for `throughput` and `revenue`
  - `outcomeGateReadiness` for consecutive-week evidence tracking

### Canonical outcome gate definitions
1. Throughput
- Metric: sourced leads/week
- Pass: `>=10`, Warn: `5-9`, Fail: `<5`
2. Qualification
- Metric: qualified/sourced
- Pass: `>=20%`, Warn: `10-19.9%`, Fail: `<10%`
3. Meeting
- Metric: booked/sourced
- Pass: `>=15%`, Warn: `8-14.9%`, Fail: `<8%`
4. Revenue
- Metric: deposits with meeting context
- Pass: `>=1` deposit, Warn: `0` deposits with `>=2` meetings, Fail: otherwise
5. Pipeline
- Metric: active pipeline USD
- Pass: `>=5000`, Warn: `2000-4999`, Fail: `<2000`

### Two-week evidence procedure (remaining milestone)
1. Generate KPI report each week via `POST /api/revenue/kpi/weekly/worker-task`.
2. Confirm `outcomeGates.summary.passOrWarnCount >= 3`.
3. Track `outcomeGateReadiness.consecutiveReadyWeeks` in `revenue_kpi_reports/latest`.
4. Mark milestone complete only after two consecutive qualifying weekly reports (not same-day).

### GitHub scheduler
- Workflow: `.github/workflows/revenue-weekly-kpi.yml`
- Repository variables (no secrets):
  - `GCP_PROJECT_ID`
  - `GCP_WIF_PROVIDER` (the existing provider must be repository-scoped to `mrrosser/agency-os-mission-control`)
  - `REVENUE_AUTOMATION_SERVICE_URL` (exact HTTPS Cloud Run service origin)
  - `REVENUE_KPI_TIMEZONE` (defaults to `America/Chicago`)
- The workflow derives the exact `revenue-automation-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com` principal, exchanges GitHub OIDC through Workload Identity Federation, and mints a Google ID token with the Cloud Run origin as its audience and verified service-account email claims.
- Grant only the existing repository principal `roles/iam.workloadIdentityUser` on that dedicated service account, and keep `roles/run.invoker` scoped to the named Cloud Run service. No service-account key or long-lived worker token is permitted.
- The generated Google ID token lasts at most ten minutes and is never written to an artifact or log.

### Two-phase migration and rollback
1. Deploy the reviewed OIDC route changes with the bounded legacy flag enabled so the old POS/KPI invokers remain available during the canary. Never print their token values.
2. Prove an OIDC request against each route, then update `revenue-pos-worker-loop` and the weekly workflow. Re-describe Scheduler and verify the exact service-account email, exact audience, body without `uid`, and absence of `Authorization`/`x-revenue-pos-token` static headers.
3. Disable the legacy flag and remove the POS/KPI token secret references only after both OIDC paths have current success receipts. The production workflow must leave only the current sanitized release tag; tagged historical revisions are public endpoints even at zero percent traffic.
4. Confirm Cloud Run, Cloud Scheduler, and GitHub Actions no longer reference the six legacy revenue token names, then disable (do not destroy) their Secret Manager versions and retain the version IDs as the rollback receipt.
5. Before step 3, rollback by restoring the previous application revision and exported Scheduler definition. After step 3, prefer rolling back the application while retaining OIDC; restore a legacy secret only as a time-bounded incident action followed by a new canary/finalize cycle.

## 4) UI Safety Flag (No External UX Change by Default)

- `NEXT_PUBLIC_ENABLE_INTERNAL_REVENUE_UI=false` (default behavior)
- When `true`, internal revenue-specific UI cards/options are shown.
- Keep this `false` in production until you intentionally roll out UI changes.

## 5) Local Verification + Post-Deploy Checks

### Local
```powershell
npm run lint
npm run test:unit
npm run test:smoke
npm run build
```

### Post-deploy (manual spot checks)
1. `GET /api/health` returns `200`.
2. `POST /api/revenue/kpi/weekly/worker-task` with a valid short-lived Google OIDC bearer token returns `200` and `authMode=oidc`.
3. `POST /api/revenue/pos/worker-task` with a valid short-lived Google OIDC bearer token returns `200` and `authMode=oidc`.
4. `GET /api/revenue/pos/status` returns healthy/degraded snapshot with queue metrics.
5. Square test webhook call returns `200` or `202` (never `401` with correct signature).
6. Confirm `identities/{uid}/revenue_kpi_reports/latest` updates after worker run.
