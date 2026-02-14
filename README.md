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
- Optional: `FIRECRAWL_API_KEY` (for website enrichment during sourcing)
- Optional: `TWILIO_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`
- Optional (recommended for background worker queueing): `LEAD_RUNS_TASK_QUEUE`, `LEAD_RUNS_TASK_LOCATION`, `LEAD_RUNS_TASK_SERVICE_ACCOUNT`
- Optional (recommended quotas): `LEAD_RUNS_MAX_RUNS_PER_DAY`, `LEAD_RUNS_MAX_LEADS_PER_DAY`, `LEAD_RUN_FAILURE_ALERT_THRESHOLD`

4) Start dev server:
```bash
npm run dev
```

## Lead Sourcing + Scoring
- The Lead Engine lives in `app/dashboard/operations`.
- If `GOOGLE_PLACES_API_KEY` (or a user-scoped secret `googlePlacesKey`) is set, live lead sourcing is enabled.
- If `FIRECRAWL_API_KEY` (or a user-scoped secret `firecrawlKey`) is set, website enrichment can extract emails/signals to improve scoring.
- Without a Places key, the Lead Engine pulls from existing CRM leads.

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
npm run deploy:firebase -- --project leadflow-review
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

## Repo Notes
- Core app code: `app/`, `components/`, `lib/`, `tests/`
- Unrelated or archived materials are staged under `please-review/`
