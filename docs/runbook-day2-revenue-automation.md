# Runbook: Day 2 Revenue Automation

Date: 2026-02-25  
Owner: Mission Control Ops

## What this does

Day 2 automation extends Day 1 by adding due-response processing:

1. runs Day 1 lead sourcing + run/job orchestration for one or more templates  
2. enforces approval-safe outbound settings (draft-first, no SMS/calls) by default  
3. processes due follow-up response tasks for each generated run  
4. re-schedules follow-up worker drain when additional due tasks are detected

Routes:
- `POST /api/revenue/day2` (operator-authenticated)
- `POST /api/revenue/day2/worker-task` (service-to-service token)

## Prerequisites

- Day 1 automation is already deployed and healthy.
- Follow-up org settings exist and `autoEnabled=true` where you want response-loop automation.
- Runtime secrets remain in env/Secret Manager only.
- Worker token set:
  - preferred: `REVENUE_DAY2_WORKER_TOKEN`
  - fallback supported: `REVENUE_DAY1_WORKER_TOKEN`

Template naming convention:
- RT Solutions: `rts-south-day1`
- Rosser NFT Gallery: `rng-south-day1`
- AI CoFoundry: `aicf-south-day1`
- Optional experiment variants:
  - RT Solutions: `rts-south-day1-exp-b`
  - Rosser NFT Gallery: `rng-south-day1-exp-b`
  - AI CoFoundry: `aicf-south-day1-exp-b`

Default timezone:
- `America/Chicago` (New Orleans, LA)

## Local execution

1. Start app:
   - `npm run dev`
2. Set env:

```bash
export REVENUE_DAY2_WORKER_TOKEN=<token>
export REVENUE_DAY2_UID=<firebase-uid>
export REVENUE_DAY2_TEMPLATE_IDS="rng-south-day1"
export REVENUE_DAY2_TIMEZONE=America/Chicago
```

3. Run worker task helper:

```bash
npm run revenue:day2:run
```

4. Validate response:
- `totals.templatesSucceeded`
- `totals.leadsScored`
- `totals.responseProcessed`
- `totals.responseCompleted`
- `warnings`

## Cloud Run / Scheduler deployment pattern

1. Set worker token on service:

```bash
gcloud run services update ssrleadflowreview \
  --region us-central1 \
  --set-env-vars REVENUE_DAY2_WORKER_TOKEN=<token-from-secret-manager>
```

2. Upsert scheduler jobs for RTS/RNG/AICF:

```bash
export GCP_PROJECT_ID=leadflow-review
export GCP_SCHEDULER_LOCATION=us-central1
export REVENUE_DAY2_SERVICE_URL=https://ssrleadflowreview-<hash>-uc.a.run.app
export REVENUE_DAY2_WORKER_TOKEN=<token-from-secret-manager>
export REVENUE_AUTOMATION_UID=<firebase-uid>
export REVENUE_AUTOMATION_TIME_ZONE=America/Chicago
export REVENUE_AUTOMATION_DAY2_CRON="30 10 * * *"
export REVENUE_AUTOMATION_DAY2_RESPONSE_MAX_TASKS=10
export REVENUE_AUTOMATION_DAY2_REQUIRE_APPROVAL_GATES=true
export REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_RTS="rts-south-day1,rts-south-day1-exp-b"
export REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_RNG="rng-south-day1,rng-south-day1-exp-b"
export REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_AICF="aicf-south-day1,aicf-south-day1-exp-b"

bash scripts/revenue-day2-scheduler-setup.sh
```

PowerShell equivalent:

```powershell
$env:GCP_PROJECT_ID = "leadflow-review"
$env:GCP_SCHEDULER_LOCATION = "us-central1"
$env:REVENUE_DAY2_SERVICE_URL = "https://ssrleadflowreview-<hash>-uc.a.run.app"
$env:REVENUE_DAY2_WORKER_TOKEN = "<token-from-secret-manager>"
$env:REVENUE_AUTOMATION_UID = "<firebase-uid>"
$env:REVENUE_AUTOMATION_TIME_ZONE = "America/Chicago"
$env:REVENUE_AUTOMATION_DAY2_CRON = "30 10 * * *"
$env:REVENUE_AUTOMATION_DAY2_RESPONSE_MAX_TASKS = "10"
$env:REVENUE_AUTOMATION_DAY2_REQUIRE_APPROVAL_GATES = "true"
$env:REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_RTS = "rts-south-day1,rts-south-day1-exp-b"
$env:REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_RNG = "rng-south-day1,rng-south-day1-exp-b"
$env:REVENUE_AUTOMATION_DAY2_TEMPLATE_IDS_AICF = "aicf-south-day1,aicf-south-day1-exp-b"

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/revenue-day2-scheduler-setup.ps1
```

Jobs created:
- `revenue-day2-rts-loop`
- `revenue-day2-rng-loop`
- `revenue-day2-aicf-loop`

### Verify scheduler lock (recommended)

```bash
export GCP_PROJECT_ID=leadflow-review
export GCP_SCHEDULER_LOCATION=us-central1
export REVENUE_CADENCE_EXPECT_BASE_URL=https://ssrleadflowreview-<hash>-uc.a.run.app
export REVENUE_CADENCE_EXPECT_TIMEZONE=America/Chicago
npm run revenue:cadence:audit
```

## Safety

- Keep `requireApprovalGates=true` unless explicitly approved to disable.
- If a legacy template is not approval-safe yet, set `REVENUE_AUTOMATION_DAY2_REQUIRE_APPROVAL_GATES=false` temporarily and track remediation.
- Day 2 is still draft-first by policy; no auto-send from this loop.
- Treat any token mismatch as a hard failure (403) and rotate token on suspected leakage.
