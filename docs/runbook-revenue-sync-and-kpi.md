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
- `REVENUE_POS_WORKER_TOKEN` (service auth for POS worker task endpoint)
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
- Worker task (service token): `POST /api/revenue/pos/worker-task`
- High-risk approval gate (auth): `POST /api/revenue/pos/approvals`

### Cloud Run deploy update (example)
```powershell
gcloud run services update mission-control `
  --region us-central1 `
  --set-env-vars "SQUARE_WEBHOOK_SIGNATURE_KEY=REDACTED,SQUARE_WEBHOOK_NOTIFICATION_URL=https://your-domain/api/webhooks/square,SQUARE_WEBHOOK_DEFAULT_UID=YOUR_UID"
```

### Square console setup
- Event destination URL must be the same public URL used in `SQUARE_WEBHOOK_NOTIFICATION_URL`.
- Subscribe to required POS event families (`PAYMENT`, `INVOICE`, `REFUND`, `ORDER`).
- Include metadata where possible: `uid`, `offerCode`, `leadDocId` (or `leadId`).

### POS worker invocation (example)
```powershell
curl -X POST https://your-domain/api/revenue/pos/worker-task `
  -H "Authorization: Bearer ${env:REVENUE_POS_WORKER_TOKEN}" `
  -H "Content-Type: application/json" `
  -d "{\"uid\":\"YOUR_FIREBASE_UID\",\"limit\":25,\"executeOutbox\":true,\"outboxLimit\":25}"
```

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
- `REVENUE_WEEKLY_KPI_WORKER_TOKEN`

### Worker request body
```json
{
  "uid": "<firebase uid>",
  "timeZone": "America/Chicago",
  "weekStartDate": "2026-02-23"
}
```

### Output
- Writes weekly report docs under:
  - `identities/{uid}/revenue_kpi_reports/{weekStartDate}`
  - `identities/{uid}/revenue_kpi_reports/latest`

### GitHub scheduler
- Workflow: `.github/workflows/revenue-weekly-kpi.yml`
- Secrets required:
  - `REVENUE_WEEKLY_KPI_BASE_URL`
  - `REVENUE_WEEKLY_KPI_WORKER_TOKEN`
  - `REVENUE_WEEKLY_KPI_UID`
- Optional repo variable:
  - `REVENUE_KPI_TIMEZONE` (defaults to `America/Chicago`)

### Cloud Run deploy update (example)
```powershell
gcloud run services update mission-control `
  --region us-central1 `
  --set-env-vars "REVENUE_WEEKLY_KPI_WORKER_TOKEN=REDACTED"
```

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
2. `POST /api/revenue/kpi/weekly/worker-task` with valid bearer token returns `200`.
3. `POST /api/revenue/pos/worker-task` with valid bearer token returns `200`.
4. `GET /api/revenue/pos/status` returns healthy/degraded snapshot with queue metrics.
5. Square test webhook call returns `200` or `202` (never `401` with correct signature).
6. Confirm `identities/{uid}/revenue_kpi_reports/latest` updates after worker run.
