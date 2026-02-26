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
- Optional (recommended for cross-project tools): `SMAUTO_MCP_SERVER_URL`, `SMAUTO_MCP_API_KEY`, `LEADOPS_MCP_SERVER_URL`, `LEADOPS_MCP_API_KEY`
- Optional (recommended for operator controls): `AGENT_ACTION_ALLOWED_UIDS` (comma-separated Firebase UIDs allowed to queue agent actions)
- Optional (internal rollout guardrails): `NEXT_PUBLIC_ENABLE_INTERNAL_REVENUE_UI=false`
- Optional: `TWILIO_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`
- Optional (recommended for live OpenAI billing pulls): `OPENAI_ADMIN_API_KEY`
- Optional (Square deposit stage webhook): `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_NOTIFICATION_URL`, `SQUARE_WEBHOOK_DEFAULT_UID`
- Optional (POS worker service auth): `REVENUE_POS_WORKER_TOKEN`
- Optional (POS side-effect policy): `POS_WORKER_ALLOW_SIDE_EFFECTS`, `POS_WORKER_AUTO_APPROVE_LOW_RISK`, `POS_WORKER_REQUIRE_APPROVAL_FOR_HIGH_RISK`, `POS_WORKER_MAX_ATTEMPTS`
- Optional (recommended for background worker queueing): `LEAD_RUNS_TASK_QUEUE`, `LEAD_RUNS_TASK_LOCATION`, `LEAD_RUNS_TASK_SERVICE_ACCOUNT`
- Optional (recommended for follow-up scheduler): `FOLLOWUPS_TASK_QUEUE`, `FOLLOWUPS_TASK_LOCATION`, `FOLLOWUPS_TASK_SERVICE_ACCOUNT`
- Optional (lead source budget defaults): `LEAD_SOURCE_BUDGET_MAX_COST_USD`, `LEAD_SOURCE_BUDGET_MAX_PAGES`, `LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC`
- Optional (competitor monitor scheduler): `COMPETITOR_MONITOR_TASK_QUEUE`, `COMPETITOR_MONITOR_TASK_LOCATION`, `COMPETITOR_MONITOR_TASK_SERVICE_ACCOUNT` (falls back to `LEAD_RUNS_*` queue vars when omitted)
- Optional (service-to-service Day 1 worker): `REVENUE_DAY1_WORKER_TOKEN`
- Optional (service-to-service Day 2 worker): `REVENUE_DAY2_WORKER_TOKEN` (falls back to Day 1 token when unset)
- Optional (social draft approvals + dispatch): `SOCIAL_DRAFT_WORKER_TOKEN` (or OIDC allowlist via `SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS`), `SOCIAL_DRAFT_APPROVAL_BASE_URL`, `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL` (or business-specific `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RTS|RNG|AICF`), `SMAUTO_MCP_SERVER_URL`
- Optional (service-to-service weekly KPI worker): `REVENUE_WEEKLY_KPI_WORKER_TOKEN`
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
- Agent action API: `POST /api/agents/actions` (queues `ping` / `pause` / `route` requests for operators).
- Includes:
  - agent runtime states (active/idle/degraded/inactive),
  - service/tool/skill health,
  - open alerts + top telemetry bug groups,
  - per-agent quick actions (`Ping`, `Pause`, `Route`),
  - timeline filters (`All`, `Tasks`, `Comments`, `Status`, `Decisions`),
  - daily quota posture,
  - projected monthly cost (live/hybrid/heuristic, depending on provider billing availability).
- Billing sources:
  - OpenAI: `GET /v1/organization/costs` (org admin key required for live pulls)
  - Twilio: Usage Records (ThisMonth, total price category)
  - ElevenLabs: subscription/usage endpoints (falls back gracefully if cost totals are unavailable)
  - Control-plane billing pulls are cached per user for 120s by default (`CONTROL_PLANE_BILLING_CACHE_TTL_MS`).

## Cross-Project MCP Connectors
- Purpose: consume external systems (`SMAuto`, LeadOps Mission Control) as tools without merging codebases.
- Runtime env vars:
  - `SMAUTO_MCP_SERVER_URL` (+ optional `SMAUTO_MCP_API_KEY`)
  - `SMAUTO_MCP_AUTH_MODE=none|api_key|id_token`
  - `SMAUTO_MCP_ID_TOKEN_AUDIENCE` (required when `SMAUTO_MCP_AUTH_MODE=id_token`)
  - `LEADOPS_MCP_SERVER_URL` (+ optional `LEADOPS_MCP_API_KEY`)
- Verification:
  - Settings -> **Runtime Config Preflight** shows connector checks.
  - Agent Nexus -> **Services + Tools** shows `SMAuto MCP` / `LeadOps MCP` states.
- Capability ownership matrix: `docs/runtime-capability-matrix.md`

## Model Prompting Guidance
- Repo-local provider guidance is tracked in `docs/model-guidance/`.
- Source links and retrieval date: `docs/model-guidance/sources.md`.
- Keep cross-model operational facts aligned using `docs/model-guidance/shared-cross-model-checklist.md`.

## Sponsor/SMB Inbox Agent Skill
- Skill file: `skills/sponsor-inbox-crm-agent/SKILL.md`
- Refined prompt pack: `docs/plans/2026-02-25-refined-prompts-sponsor-crm.md`
- Rubric template (sync target): `please-review/config-templates/sponsor-inbox-rubric.v1.json`

## Revenue Day 1 Automation
- Manual/authenticated route: `POST /api/revenue/day1`
- Scheduler/service route: `POST /api/revenue/day1/worker-task`
- Use case: source leads from a saved template, start outreach run, and optionally seed follow-up queue in one call.
- Worker auth: send `Authorization: Bearer <REVENUE_DAY1_WORKER_TOKEN>` (or `x-revenue-day1-token`).
- Runner script: `npm run revenue:day1:run`
- Template seeding script: `npm run revenue:day1:seed-templates`
- Scheduler setup helpers:
  - `scripts/revenue-day1-scheduler-setup.sh` (bash)
  - `scripts/revenue-day1-scheduler-setup.ps1` (Windows PowerShell)
- Full setup/runbook: `docs/runbook-day1-revenue-automation.md`

## Revenue Day 2 Automation
- Manual/authenticated route: `POST /api/revenue/day2`
- Scheduler/service route: `POST /api/revenue/day2/worker-task`
- Use case: run Day 1 pipeline generation and process due follow-up responses in one loop.
- Worker auth: send `Authorization: Bearer <REVENUE_DAY2_WORKER_TOKEN>` (or `x-revenue-day2-token`); route falls back to `REVENUE_DAY1_WORKER_TOKEN`.
- Runner script: `npm run revenue:day2:run`
- Scheduler setup helpers:
  - `scripts/revenue-day2-scheduler-setup.sh` (bash)
  - `scripts/revenue-day2-scheduler-setup.ps1` (Windows PowerShell)
- Full setup/runbook: `docs/runbook-day2-revenue-automation.md`

## Social Draft Approvals (Google Space + Phone)
- Authenticated route: `POST /api/social/drafts`
- Worker route (OpenCall/service): `POST /api/social/drafts/worker-task`
- RNG weekly worker route (OpenCall/scheduler): `POST /api/social/drafts/rng-weekly/worker-task`
- Multi-business weekly worker route (OpenCall/scheduler): `POST /api/social/drafts/weekly/worker-task`
- Dispatch drain worker route (OpenCall/service/scheduler): `POST /api/social/drafts/dispatch/worker-task`
- Approval link route: `GET /api/social/drafts/{draftId}/decision`
- Worker auth: `Authorization: Bearer <SOCIAL_DRAFT_WORKER_TOKEN>` (falls back to revenue worker token envs) or Cloud Scheduler OIDC bearer token from allowlisted service accounts (`SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS`).
- Runner script (service-safe): `npm run social:draft:run`
- Dispatch runner script (service-safe): `npm run social:dispatch:run`
- Recommended worker base URL: `https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app` (or resolve live URL with `gcloud run services describe ssrleadflowreview --project leadflow-review --region us-central1 --format='value(status.url)'`)
- Required env:
  - `SOCIAL_DRAFT_WORKER_TOKEN`
  - `SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS` (recommended for Cloud Scheduler OIDC; comma-separated)
  - `SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES` (optional comma-separated audience allowlist; defaults to request URL)
  - `SOCIAL_DRAFT_APPROVAL_BASE_URL`
  - `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG` (or default webhook)
  - `SMAUTO_MCP_SERVER_URL`
  - `SMAUTO_MCP_AUTH_MODE=none|api_key|id_token`
  - `SMAUTO_MCP_API_KEY` (required when `SMAUTO_MCP_AUTH_MODE=api_key`)
  - `SMAUTO_MCP_ID_TOKEN_AUDIENCE` (required when `SMAUTO_MCP_AUTH_MODE=id_token`)
  - `SMAUTO_MCP_SOCIAL_DISPATCH_TOOL` (optional MCP tool name override; default `social.dispatch.enqueue`)
  - `SMAUTO_MCP_WEBHOOK_FALLBACK_ENABLED` (optional; default `true`)
- Runbook + payload examples: `docs/runbook-social-draft-approvals.md`
- Mobile workflow: operator receives Approve/Reject buttons in Google Chat Space and can complete the decision from phone browser without opening Mission Control UI.

## Revenue Weekly KPI Rollup
- Manual/authenticated route: `POST /api/revenue/kpi/weekly`
- Scheduler/service route: `POST /api/revenue/kpi/weekly/worker-task`
- Latest snapshot route: `GET /api/revenue/kpi/latest`
- Worker auth: send `Authorization: Bearer <REVENUE_WEEKLY_KPI_WORKER_TOKEN>` (or `x-revenue-weekly-kpi-token`).
- Writes weekly and latest KPI docs under `identities/{uid}/revenue_kpi_reports/*`.
- Automation workflow: `.github/workflows/revenue-weekly-kpi.yml`
- Dashboard surface (internal revenue UI flag): weekly KPI summary cards + decision counts.

## Square Deposit Webhook
- Route: `POST /api/webhooks/square`
- Verifies `x-square-hmacsha256-signature` with `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- Accepts allowlisted Square event families (`PAYMENT.*`, `INVOICE.*`, `REFUND.*`, `ORDER.*`) and queues deterministic POS worker events under `identities/{uid}/pos_worker_events/*`.
- Processes completed payment events inline and updates matching leads to `pipelineStage=deposit_received` (idempotent by `event_id` in `square_webhook_events`).
- POS worker service route: `POST /api/revenue/pos/worker-task` (Bearer or `x-revenue-pos-token` = `REVENUE_POS_WORKER_TOKEN`).
- POS worker status route: `GET /api/revenue/pos/status` (authenticated).
- High-risk POS actions can be approved via `POST /api/revenue/pos/approvals` and side-effect outbox items are written to `identities/{uid}/pos_worker_outbox/*`.

## Mission Control -> AI_HELL_MARY Sync
- Sync command:
```bash
node scripts/sync-ai-hell-mary.mjs --target-root "C:\\CTO Projects\\AI_HELL_MARY"
```
- Windows scheduler helper:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-ai-hell-mary-nightly.ps1
```
- Runbook: `docs/runbook-revenue-sync-and-kpi.md`

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
  - only queues write actions when `globalPolicies.voiceOpsPolicy.enabled` is explicitly `true`,
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
  - Calendar date/time parsing uses business-local timezone from knowledge policy (`calendarDefaults.timeZone`) and falls back to `VOICE_ACTIONS_DEFAULT_TIMEZONE`.
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
- Uses a safe channel promotion flow:
  1) deploy candidate to a preview channel,
  2) run fail-closed post-deploy smoke against preview URL,
  3) promote preview channel to `live` only on smoke success.
- Dedicated CI gate for `npm test`: `.github/workflows/ci-tests.yml`.

Local deploy (recommended: trims SSR bundle by omitting devDependencies during frameworks install):
```bash
npm run deploy:firebase -- leadflow-review
```
If your npm version rewrites flags, this direct form always works:
```bash
node scripts/firebase-deploy.mjs deploy --only hosting --project leadflow-review
```

Required GitHub Actions configuration:
- `ENV_LOCAL` (full `.env.local` content)
- `vars.GCP_WIF_PROVIDER` (Workload Identity Provider resource name)
- `vars.GCP_WIF_SERVICE_ACCOUNT` (service account email for GitHub OIDC auth)
- Optional (defaults shown):
  - `vars.GCP_PROJECT_ID` (`leadflow-review`)
  - `vars.FIREBASE_HOSTING_SITE` (`leadflow-review`)
  - `vars.CLOUD_RUN_REGION` (`us-central1`)
  - `vars.FIREBASE_SSR_SERVICE` (`ssrleadflowreview`)
  - `vars.PROD_SMOKE_BASE_URL` (`https://leadflow-review.web.app`)
  - `vars.SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS` (defaults to `social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com`)
  - `vars.SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES` (optional; defaults to SSR service weekly worker audiences)

Production health monitor:
- `.github/workflows/postdeploy-health-monitor.yml` runs authenticated smoke on a schedule.
- Requires `vars.NEXT_PUBLIC_FIREBASE_API_KEY` plus the WIF vars above.

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

Phase 3: scheduled retention cleanup
- `.github/workflows/telemetry-retention-cleanup.yml` runs daily and deletes old telemetry docs by time-based retention windows.
- Manual `workflow_dispatch` supports dry-run and retention overrides for safe first runs.
- It prunes:
  - `telemetry_error_events` by `createdAt`
  - `telemetry_error_groups` by `lastSeenAt`
- Cleanup is idempotent and bounded per run with batch + max-delete caps.
- Cleanup status is written to Firestore and exposed at `GET /api/telemetry/retention-status` (shown in Operations as **Telemetry Cleanup**).
- Manual trigger API for Operations UI: `POST /api/telemetry/retention-run`.

Config (SSR runtime):
- `TELEMETRY_ENABLED=true` (set to `false` to disable ingest)
- `TELEMETRY_SERVER_ERRORS=true` (optional: capture 5xx responses)
- Optional: `TELEMETRY_ALLOWED_ORIGINS` (comma-separated allowlist for browser telemetry)

Config (GitHub Action triage):
- Uses Workload Identity Federation (`vars.GCP_WIF_PROVIDER` + `vars.GCP_WIF_SERVICE_ACCOUNT`) to read/write Firestore groups.
- Uses `${{ github.token }}` to create issues in this repo.

Config (retention cleanup):
- `TELEMETRY_EVENT_RETENTION_DAYS` (default `30`)
- `TELEMETRY_GROUP_RETENTION_DAYS` (default `180`, must be >= event retention)
- `TELEMETRY_CLEANUP_BATCH_SIZE` (default `200`)
- `TELEMETRY_CLEANUP_MAX_DELETES_PER_COLLECTION` (default `5000`)
- `TELEMETRY_CLEANUP_DRY_RUN` (default `false`)
- Optional for manual UI-triggered dispatch (`POST /api/telemetry/retention-run`):
  - `GITHUB_WORKFLOW_DISPATCH_TOKEN` (required for dispatch)
  - `GITHUB_WORKFLOW_OWNER`, `GITHUB_WORKFLOW_REPO` (fallback: `GITHUB_REPOSITORY`)
  - `GITHUB_TELEMETRY_RETENTION_WORKFLOW` (default: `telemetry-retention-cleanup.yml`)
  - `GITHUB_TELEMETRY_RETENTION_REF` (default: `main`)
  - `TELEMETRY_CLEANUP_ALLOWED_UIDS` (optional CSV allowlist)

Run triage locally:
```powershell
$env:GCLOUD_PROJECT="leadflow-review"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\firebase-adminsdk.json"
$env:GITHUB_TOKEN="<your token>" # optional if you want to create issues locally
$env:GITHUB_REPOSITORY="mrrosser/agency-os-mission-control"
node scripts/telemetry-triage.js
```

Run retention cleanup locally:
```powershell
$env:GCLOUD_PROJECT="leadflow-review"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\firebase-adminsdk.json"
$env:TELEMETRY_EVENT_RETENTION_DAYS="30"
$env:TELEMETRY_GROUP_RETENTION_DAYS="180"
$env:TELEMETRY_CLEANUP_DRY_RUN="true" # flip to false to delete
npm run telemetry:cleanup
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
