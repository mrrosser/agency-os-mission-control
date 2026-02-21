# LeadFlow Mission Control

Lead generation command center: source leads, score them, and visualize the outreach journey across MCP + AI steps. Built as a Firebase-backed Next.js app with a real-time dashboard and an API vault for tenant-specific keys.

## Run Locally
1) Install deps:
```bash
npm ci
```
2) Create `.env.local` from the template:
```bash
copy .env.local.example .env.local
```
3) Fill in required values in `.env.local`:
- `NEXT_PUBLIC_FIREBASE_*` (Firebase web app config)
- `FIREBASE_PROJECT_ID`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- Optional: `GOOGLE_PICKER_API_KEY` (browser key; enables Google Drive Picker UI in Knowledge Base)
- Optional: `GOOGLE_DRIVE_APP_ID` (Drive Picker app id; set to your GCP project number for Shared Drives support)
- Optional: `GOOGLE_PLACES_API_KEY` (for live lead sourcing)
- Optional: `APIFY_TOKEN` + `APIFY_GOOGLE_MAPS_ACTOR_ID` (enables Apify Maps fallback/provider)
- Optional: `APIFY_EST_COST_PER_1K_RESULTS_USD` (used for estimated Apify source cost in diagnostics)
- Optional: `FIRECRAWL_API_KEY` (for website enrichment during sourcing)
- Optional: `TWILIO_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`
- Optional (recommended for live OpenAI billing pulls): `OPENAI_ADMIN_API_KEY`
- Optional (recommended for background worker queueing): `LEAD_RUNS_TASK_QUEUE`, `LEAD_RUNS_TASK_LOCATION`, `LEAD_RUNS_TASK_SERVICE_ACCOUNT`
- Optional (recommended for follow-up scheduler): `FOLLOWUPS_TASK_QUEUE`, `FOLLOWUPS_TASK_LOCATION`, `FOLLOWUPS_TASK_SERVICE_ACCOUNT`
- Optional (lead source budget defaults): `LEAD_SOURCE_BUDGET_MAX_COST_USD`, `LEAD_SOURCE_BUDGET_MAX_PAGES`, `LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC`
- Optional (competitor monitor scheduler): `COMPETITOR_MONITOR_TASK_QUEUE`, `COMPETITOR_MONITOR_TASK_LOCATION`, `COMPETITOR_MONITOR_TASK_SERVICE_ACCOUNT` (falls back to `LEAD_RUNS_*` queue vars when omitted)
- Optional (recommended quotas): `LEAD_RUNS_MAX_RUNS_PER_DAY`, `LEAD_RUNS_MAX_LEADS_PER_DAY`, `LEAD_RUN_FAILURE_ALERT_THRESHOLD`

4) Start dev server:
```bash
npm run dev
```

## Lead Sourcing + Scoring
- The Lead Engine lives in `app/dashboard/operations`.
- If `GOOGLE_PLACES_API_KEY` (or a user-scoped secret `googlePlacesKey`) is set, live lead sourcing is enabled.
- If Google Places is not configured but `APIFY_TOKEN` is set, sourcing can use `apifyMaps`.
- If `FIRECRAWL_API_KEY` (or a user-scoped secret `firecrawlKey`) is set, website enrichment can extract emails/signals to improve scoring.
- Without a Places key, the Lead Engine pulls from existing CRM leads.
- Source diagnostics include per-run budget usage (cost/pages/runtime) and stop reasons.

## Competitor Monitor (Scheduled Reports)
- Upsert/list monitors: `POST/GET /api/competitors/monitor`
- Worker execution endpoint: `POST /api/competitors/monitor/worker-task`
- Report retrieval: `GET /api/competitors/monitor/:monitorId/reports`
- Worker dispatch uses Cloud Tasks when queue env vars are configured; otherwise immediate internal HTTP trigger is used.
- Reports are stored per monitor as both Markdown and HTML artifacts.

## Agent Nexus Dashboard
- New control-plane dashboard: `app/dashboard/agents` (`/dashboard/agents` in the UI).
- Backend snapshot API: `GET /api/agents/control-plane`.
- Includes:
  - agent runtime states (active/idle/degraded/inactive),
  - service/tool/skill health,
  - open alerts + top telemetry bug groups,
  - daily quota posture,
  - projected monthly cost (live/hybrid/heuristic, depending on provider billing availability).
- Billing sources:
  - OpenAI: `GET /v1/organization/costs` (org admin key required for live pulls)
  - Twilio: Usage Records (ThisMonth, total price category)
  - ElevenLabs: subscription/usage endpoints (falls back gracefully if cost totals are unavailable)

## Competitor Monitor Dashboard
- UI: `/dashboard/competitors`
- APIs:
  - `GET/POST /api/competitors/monitor`
  - `POST /api/competitors/monitor/worker-task`
  - `GET /api/competitors/monitor/:monitorId/reports`
- Monitor runs produce Markdown + HTML report artifacts per monitor.

## Twilio Inbound Voice Webhook (Scaffold)
- Endpoint: `POST /api/twilio/voice-webhook`
- Twilio Console Voice webhook URL example:
  - `https://<your-domain>/api/twilio/voice-webhook?uid=<firebase_uid>`
  - optional hardening token: `https://<your-domain>/api/twilio/voice-webhook?uid=<firebase_uid>&token=<TWILIO_VOICE_WEBHOOK_TOKEN>`
- Optional env for webhook hardening:
  - `TWILIO_VOICE_WEBHOOK_TOKEN` (if set, webhook requires matching `?token=...`)
- Current behavior:
  - answers inbound calls with `<Gather>` speech loop,
  - detects action intents (`calendar.createMeet`, `gmail.createDraft`, `crm.upsertLead`),
  - writes idempotent action requests to Firestore `voice_action_requests` (queued for review),
  - stores call session state in `voice_call_sessions`.

## Voice Action Worker (Auto-execution)
- Endpoint: `POST /api/twilio/voice-actions/worker-task`
- Auth: body must include `workerToken` that matches `VOICE_ACTIONS_WORKER_TOKEN`.
- Recommended env:
  - `VOICE_ACTIONS_WORKER_TOKEN` (required)
  - `VOICE_ACTIONS_DEFAULT_UID` (optional fallback if webhook URL does not include `uid`)
  - `VOICE_ACTIONS_DEFAULT_TIMEZONE` (optional, default `America/Chicago`)
  - `VOICE_ACTIONS_TASK_QUEUE`, `VOICE_ACTIONS_TASK_LOCATION`, `VOICE_ACTIONS_TASK_SERVICE_ACCOUNT` (optional Cloud Tasks dispatch; falls back to internal HTTP trigger when absent)
- Request shape:
  - `{ "workerToken": "...", "maxTasks": 10, "dryRun": false }`
- Processing behavior:
  - Claims queued records from `voice_action_requests`.
  - Executes `gmail.createDraft` and `calendar.createMeet` with DNC checks.
  - Upserts `crm.upsertLead` into `voice_crm_leads`.
  - Marks each request as `complete`, `needs_input`, or `error`.
  - `POST /api/twilio/voice-webhook` now triggers this worker immediately after queueing a write action.

## Google OAuth Redirect URIs (recommended)
- Local: `http://localhost:3000/api/google/callback`
- Production: `https://leadflow-review.web.app/api/google/callback`

Notes:
- Do not use `0.0.0.0` in OAuth redirect URIs; browsers treat it as an invalid address.
- If you run the dev server on a different port (e.g. 8080), add `http://localhost:8080/api/google/callback` to the Google OAuth client and set `GOOGLE_OAUTH_REDIRECT_URI` accordingly.

## Deploy (Firebase Hosting)
The workflow `.github/workflows/firebase-hosting-merge.yml` deploys on push to `main`.

Local deploy (recommended: trims SSR bundle by omitting devDependencies during frameworks install):
```bash
npm run deploy:firebase -- leadflow-review
```
If your npm version rewrites flags, this direct form always works:
```bash
node scripts/firebase-deploy.mjs deploy --only hosting --project leadflow-review
```

Required GitHub Actions secrets:
- `ENV_LOCAL` (full `.env.local` content)
- `FIREBASE_SERVICE_ACCOUNT_LEADFLOW_REVIEW` (Firebase Admin SDK JSON)

Expected live URL (Firebase Hosting default):
- `https://leadflow-review.web.app/`

## Telemetry + Triage (Phase 1/2)
Phase 1: runtime error capture
- Client + React errors are captured by `components/providers/telemetry-reporter.tsx` and the global `ErrorBoundary`.
- Server 5xx can also be captured (optional) via `lib/api/handler.ts`.
- Errors ingest into Firestore:
  - `telemetry_error_groups/{fingerprint}` (deduped aggregates)
  - `telemetry_error_events/{eventId}` (individual events)

Phase 2: automated triage
- `.github/workflows/telemetry-triage.yml` runs hourly and creates GitHub issues for high-signal groups.
- It is idempotent: once a group is linked to an issue, it will not create duplicates.
- It does not auto-merge or auto-deploy.

Config (SSR runtime):
- `TELEMETRY_ENABLED=true` (set to `false` to disable ingest)
- `TELEMETRY_SERVER_ERRORS=true` (optional: capture 5xx responses)
- Optional: `TELEMETRY_ALLOWED_ORIGINS` (comma-separated allowlist for browser telemetry)

Config (GitHub Action triage):
- Uses `FIREBASE_SERVICE_ACCOUNT_LEADFLOW_REVIEW` to read/write Firestore groups.
- Uses `${{ github.token }}` to create issues in this repo.

Run triage locally:
```powershell
$env:GCLOUD_PROJECT="leadflow-review"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\firebase-adminsdk.json"
$env:GITHUB_TOKEN="<your token>" # optional if you want to create issues locally
$env:GITHUB_REPOSITORY="mrrosser/agency-os-mission-control"
node scripts/telemetry-triage.js
```

## Lead Run Queue + Limits (recommended defaults for 5-10 active users)
- Queue dispatch:
  - `LEAD_RUNS_TASK_QUEUE=lead-run-worker`
  - `LEAD_RUNS_TASK_LOCATION=us-central1`
  - `LEAD_RUNS_TASK_SERVICE_ACCOUNT=<cloud-run-invoker-sa@project.iam.gserviceaccount.com>`
  - `LEAD_RUNS_TASK_DELAY_SECONDS=0`
- Daily org limits:
  - `LEAD_RUNS_MAX_RUNS_PER_DAY=80`
  - `LEAD_RUNS_MAX_LEADS_PER_DAY=1200`
  - `LEAD_RUNS_MAX_ACTIVE_RUNS=3`
  - `LEAD_RUN_FAILURE_ALERT_THRESHOLD=3`
- Alert escalation + scheduling retry:
  - `LEAD_RUN_ALERT_ESCALATION_MINUTES=30`
  - `LEAD_RUNS_CALENDAR_MAX_ATTEMPTS=3`
  - `LEAD_RUNS_CALENDAR_BACKOFF_MS=1500`

Notes:
- If queue env vars are not set, worker dispatch falls back to internal HTTP trigger.
- Alerts are written to `lead_run_alerts`, can be acknowledged in Operations, and escalate to telemetry if left open.
- Runtime config preflight (auth required): `GET /api/runtime/preflight` (also shown in Settings -> API Access).

## Follow-up Draft Queue + Limits (recommended defaults for 5-10 active users)
- Queue dispatch:
  - `FOLLOWUPS_TASK_QUEUE=followups-worker`
  - `FOLLOWUPS_TASK_LOCATION=us-central1`
  - `FOLLOWUPS_TASK_SERVICE_ACCOUNT=<cloud-run-invoker-sa@project.iam.gserviceaccount.com>`
  - `FOLLOWUPS_TASK_DELAY_SECONDS=0`
- Defaults (org settings override these):
  - `FOLLOWUPS_AUTO_ENABLED=true`
  - `FOLLOWUPS_MAX_TASKS_PER_INVOCATION=5`
  - `FOLLOWUPS_DRAIN_DELAY_SECONDS=30`

Notes:
- If `FOLLOWUPS_TASK_QUEUE` is not set, the follow-up worker reuses the lead-run queue env vars (`LEAD_RUNS_TASK_QUEUE`, etc.).
- If no queue env vars are set, the worker will only trigger immediate runs (no future scheduling) to keep local dev safe.
- Org-level controls live at Settings -> Integrations -> Follow-up Automation.

## Troubleshooting
- If `/api/*` requests return HTML (e.g. `Unexpected token '<'`) or 403s, the Firebase frameworks SSR service may not be invokable.
- Ensure the Cloud Run service is public-invoker (the APIs still enforce Firebase ID tokens per-route):
```bash
gcloud run services add-iam-policy-binding ssrleadflowreview \
  --project leadflow-review \
  --region us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```
- The Frameworks backend memory is configured in `firebase.json` via `hosting.frameworksBackend.memory`.
- If `/api/*` intermittently returns HTML 502/503 and Cloud Run logs show memory OOM, you can bump the SSR service memory:
```bash
gcloud run services update ssrleadflowreview \
  --project leadflow-review \
  --region us-central1 \
  --memory 512Mi
```

## Tests
```bash
npm test
```

## RT Loop Gates (Recommended)
Runs lint + unit + smoke + build + security scans and writes a report to `docs/reports/latest-run.md`:
```powershell
.\scripts\loop\run.ps1
```

Playwright (live smoke, optional):
```powershell
$env:PLAYWRIGHT_BASE_URL="https://leadflow-review.web.app"
npm run test:pw
```

Post-deploy production smoke (auth + worker path):
```powershell
$env:SMOKE_BASE_URL="https://leadflow-review.web.app"
npm run test:postdeploy
```

Google OAuth verification readiness quick check:
```powershell
npm run check:oauth-readiness -- https://leadflow-review.web.app
```

## Repo Notes
- Core app code: `app/`, `components/`, `lib/`, `tests/`
- Unrelated or archived materials are staged under `please-review/`
