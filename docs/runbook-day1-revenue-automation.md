# Runbook: Day 1 Revenue Automation

Date: 2026-02-24  
Owner: Mission Control Ops

## What this does

Day 1 automation executes:

1. lead sourcing from a saved lead template  
2. run creation with normalized `businessUnit` + `offerCode`  
3. lead-run worker queue start (email/SMS/call/avatar behavior from template outreach config)  
4. optional follow-up queue priming

Routes:
- `POST /api/revenue/day1` (operator-authenticated)
- `POST /api/revenue/day1/worker-task` (service-to-service token)

## Prerequisites

- Lead template exists in `identities/{uid}/lead_run_templates/{templateId}`.
- Deployed service includes Day1 routes (`/api/revenue/day1` + `/api/revenue/day1/worker-task`).
- Runtime secrets are configured (env/Secret Manager only):
  - Google Places key
  - Firecrawl key (optional but recommended)
  - HeyGen key (if `useAvatar=true`)
- Queue envs for lead run/follow-ups are configured for production.

Additional worker auth env:
- `REVENUE_DAY1_WORKER_TOKEN`

Template naming convention (multi-business, South launch):
- RT Solutions: `rts-south-day1`
- Rosser NFT Gallery: `rng-south-day1`
- AI CoFoundry: `aicf-south-day1`

Default timezone for operations:
- `America/Chicago` (New Orleans, LA)

## Local execution

1. Start app:
   - `npm run dev`
2. Seed standard South templates (one-time per operator uid):

```bash
export REVENUE_AUTOMATION_UID=<firebase-uid>
export GCLOUD_PROJECT=leadflow-review
npm run revenue:day1:seed-templates
```

3. Run Day 1 manually (authenticated session):

```bash
curl -X POST http://localhost:3000/api/revenue/day1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <firebase-id-token>" \
  -d '{
    "templateId": "rts-south-day1",
    "dryRun": true,
    "autoQueueFollowups": true
  }'
```

4. Inspect response:
   - `runId`
   - `leadTotals`
   - `job.status`
   - `followups.*`

## Cloud Run / Scheduler deployment pattern

1. Set worker token on service:

```bash
gcloud run services update ssrleadflowreview \
  --region us-central1 \
  --set-env-vars REVENUE_DAY1_WORKER_TOKEN=<token-from-secret-manager>
```

If you need to mint a token first:

```bash
openssl rand -hex 32
```

Store token in Secret Manager and attach to Cloud Run:

```bash
echo -n "<token>" | gcloud secrets versions add revenue-day1-worker-token \
  --project leadflow-review \
  --data-file=-

gcloud run services update ssrleadflowreview \
  --region us-central1 \
  --project leadflow-review \
  --update-secrets REVENUE_DAY1_WORKER_TOKEN=revenue-day1-worker-token:latest
```

2. Create daily scheduler job (example 8:00 AM CT):

```bash
gcloud scheduler jobs create http revenue-day1-rt \
  --location us-central1 \
  --schedule "0 8 * * *" \
  --time-zone "America/Chicago" \
  --uri "https://<your-service-url>/api/revenue/day1/worker-task" \
  --http-method POST \
  --headers "Content-Type=application/json,Authorization=Bearer <same-token>" \
  --message-body '{
    "uid":"<operator-uid>",
    "templateId":"rts-south-day1",
    "dryRun":false,
    "autoQueueFollowups":true
  }'
```

### Multi-business scheduler setup (recommended)

Use helper script to upsert start + second-pass follow-up seed jobs for all three businesses:

Enable Cloud Scheduler API once per project:

```bash
gcloud services enable cloudscheduler.googleapis.com --project leadflow-review
```

```bash
export GCP_PROJECT_ID=leadflow-review
export GCP_SCHEDULER_LOCATION=us-central1
export REVENUE_DAY1_SERVICE_URL=https://ssrleadflowreview-<hash>-uc.a.run.app
export REVENUE_DAY1_WORKER_TOKEN=<token-from-secret-manager>
export REVENUE_AUTOMATION_UID=<firebase-uid>
export REVENUE_AUTOMATION_TIME_ZONE=America/Chicago
export REVENUE_AUTOMATION_START_CRON="0 8 * * *"
export REVENUE_AUTOMATION_SEED_CRON_D2="0 10 * * *"
export REVENUE_AUTOMATION_SEED_CRON_D5="20 10 * * *"
export REVENUE_AUTOMATION_SEED_CRON_D10="40 10 * * *"
export REVENUE_AUTOMATION_SEED_CRON_D14="0 11 * * *"

bash scripts/revenue-day1-scheduler-setup.sh
```

Windows PowerShell equivalent:

```powershell
$env:GCP_PROJECT_ID = "leadflow-review"
$env:GCP_SCHEDULER_LOCATION = "us-central1"
$env:REVENUE_DAY1_SERVICE_URL = "https://ssrleadflowreview-<hash>-uc.a.run.app"
$env:REVENUE_DAY1_WORKER_TOKEN = "<token-from-secret-manager>"
$env:REVENUE_AUTOMATION_UID = "<firebase-uid>"
$env:REVENUE_AUTOMATION_TIME_ZONE = "America/Chicago"
$env:REVENUE_AUTOMATION_START_CRON = "0 8 * * *"
$env:REVENUE_AUTOMATION_SEED_CRON_D2 = "0 10 * * *"
$env:REVENUE_AUTOMATION_SEED_CRON_D5 = "20 10 * * *"
$env:REVENUE_AUTOMATION_SEED_CRON_D10 = "40 10 * * *"
$env:REVENUE_AUTOMATION_SEED_CRON_D14 = "0 11 * * *"

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/revenue-day1-scheduler-setup.ps1
```

What the script configures:
- `revenue-day1-rts-start`
- `revenue-day1-rng-start`
- `revenue-day1-aicf-start`
- `revenue-day1-rts-followup-seed` (D+2, sequence 1)
- `revenue-day1-rts-followup-seed-d5` (D+5, sequence 2)
- `revenue-day1-rts-followup-seed-d10` (D+10, sequence 3)
- `revenue-day1-rts-followup-seed-d14` (D+14, sequence 4, recycle lane)
- `revenue-day1-rng-followup-seed` (D+2, sequence 1)
- `revenue-day1-rng-followup-seed-d5` (D+5, sequence 2)
- `revenue-day1-rng-followup-seed-d10` (D+10, sequence 3)
- `revenue-day1-rng-followup-seed-d14` (D+14, sequence 4, recycle lane)
- `revenue-day1-aicf-followup-seed` (D+2, sequence 1)
- `revenue-day1-aicf-followup-seed-d5` (D+5, sequence 2)
- `revenue-day1-aicf-followup-seed-d10` (D+10, sequence 3)
- `revenue-day1-aicf-followup-seed-d14` (D+14, sequence 4, recycle lane)

### Verify scheduler lock (recommended)

After creating/updating cadence jobs, run the audit script:

```bash
export GCP_PROJECT_ID=leadflow-review
export GCP_SCHEDULER_LOCATION=us-central1
export REVENUE_CADENCE_EXPECT_BASE_URL=https://ssrleadflowreview-<hash>-uc.a.run.app
export REVENUE_CADENCE_EXPECT_TIMEZONE=America/Chicago
npm run revenue:cadence:audit
```

PowerShell:

```powershell
$env:GCP_PROJECT_ID = "leadflow-review"
$env:GCP_SCHEDULER_LOCATION = "us-central1"
$env:REVENUE_CADENCE_EXPECT_BASE_URL = "https://ssrleadflowreview-<hash>-uc.a.run.app"
$env:REVENUE_CADENCE_EXPECT_TIMEZONE = "America/Chicago"
npm run revenue:cadence:audit
```

Second-pass behavior:
- Calls the same Day1 worker with `forceRun=false`.
- If the run already exists for the day, it does not create a new run.
- It re-seeds follow-up tasks so leads that were initially `skippedNoOutreach` are picked up once outreach receipts exist.
- D+2/D+5/D+10/D+14 jobs use deterministic `followupSequence` values (`1`, `2`, `3`, `4`) to avoid duplicate task creation.
- Sequence `4` is the recycle branch:
  - defaults to `no_response` recycle messaging;
  - upgrades to `not_now` branch when lead docs include `followupDisposition=not_now` (or `notNowUntil` / `nextFollowupAt` date fields).

## Idempotency behavior

- Run id is deterministic per `uid + templateId + dateKey`.
- If the same day run exists and `forceRun=false`, API returns `reused=true`.
- Use `forceRun=true` only when intentionally creating a second run for the same day.

## Safety

- Keep `draftFirst=true` for outbound messages unless explicitly approved otherwise.
- Keep `requireBookingConfirmation=true` (default) so lead-run workers do **not** auto-book calendar events until the lead is explicitly confirmed (status/stage/confirmation signal).
- Keep pricing/payment/contract steps approval-gated.
- Never put API keys/tokens in request payloads or git-tracked files.
