# Runbook: Day30 Revenue Automation Loop

Date: 2026-02-25  
Owner: Mission Control Ops

## What this does

Day30 automation is the no-touch execution loop for the 30-day revenue plan:

1. runs Day2 automation across one or more templates (draft-first, approval-safe)  
2. updates closer queue for hot booking/proposal leads (30-minute SLA)  
3. updates revenue memory summary (win/loss + objection signals)  
4. generates daily executive digest docs  
5. (optionally) runs weekly KPI rollup and service-lab candidate generation

Routes:
- `POST /api/revenue/day30` (operator-authenticated)
- `POST /api/revenue/day30/worker-task` (service-to-service token)

## Prerequisites

- Day1 + Day2 routes are already deployed and healthy.
- Follow-up org settings configured for response loop where needed.
- Runtime secrets remain in env/Secret Manager only.
- Worker token:
  - preferred: `REVENUE_DAY30_WORKER_TOKEN`
  - fallback: `REVENUE_DAY2_WORKER_TOKEN`
  - fallback: `REVENUE_DAY1_WORKER_TOKEN`

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

## Data outputs

- Daily digest:
  - `identities/{uid}/executive_brain/daily/entries/{dateKey}`
  - `identities/{uid}/executive_brain/daily/entries/latest`
- Revenue memory:
  - `identities/{uid}/revenue_memory/{weekStartDate}`
  - `identities/{uid}/revenue_memory/latest`
- Closer queue:
  - `identities/{uid}/closer_queue/{queueId}`
  - `identities/{uid}/closer_queue_state/latest`
- Service lab candidates:
  - `identities/{uid}/service_lab_candidates/{candidateId}`
- Variant decision snapshots (optional write mode):
  - `identities/{uid}/revenue_variant_decisions/{date-dN}`
  - `identities/{uid}/revenue_variant_decisions/latest`

## Local execution

1. Start app:
   - `npm run dev`
2. Set env:

```bash
export REVENUE_DAY30_WORKER_TOKEN=<token>
export REVENUE_DAY30_UID=<firebase-uid>
export REVENUE_DAY30_TEMPLATE_IDS="rts-south-day1,rng-south-day1,aicf-south-day1"
export REVENUE_DAY30_TIMEZONE=America/Chicago
```

3. Run:

```bash
npm run revenue:day30:run
```

4. Validate response:
- `day2.totals.templatesSucceeded`
- `day2.totals.responseCompleted`
- `closerQueue.queueSize`
- `serviceLab.generated`
- `dailyDigest.summary`

5. Generate deterministic keep/fix/kill/watch decision artifact from last 7 days:

```bash
npm run revenue:variant:decide
```

Optional env for decision tuning/persistence:
- `REVENUE_VARIANT_DAYS` (default `7`)
- `REVENUE_VARIANT_DECISION_MIN_RUNS` (default `3`)
- `REVENUE_VARIANT_DECISION_MIN_PROCESSED` (default `12`)
- `REVENUE_VARIANT_DECISION_PATH` (JSON output path)
- `REVENUE_VARIANT_WRITE_FIRESTORE=true` (persist to `revenue_variant_decisions`)

## Cloud Run / Scheduler deployment pattern

1. Set worker token on service:

```bash
gcloud run services update ssrleadflowreview \
  --region us-central1 \
  --set-env-vars REVENUE_DAY30_WORKER_TOKEN=<token-from-secret-manager>
```

2. Upsert scheduler jobs (daily loops + weekly brain loop):

```bash
export GCP_PROJECT_ID=leadflow-review
export GCP_SCHEDULER_LOCATION=us-central1
export REVENUE_DAY30_SERVICE_URL=https://ssrleadflowreview-<hash>-uc.a.run.app
export REVENUE_DAY30_WORKER_TOKEN=<token-from-secret-manager>
export REVENUE_AUTOMATION_UID=<firebase-uid>
export REVENUE_AUTOMATION_TIME_ZONE=America/Chicago
export REVENUE_AUTOMATION_DAY30_CRON="15 9 * * *"
export REVENUE_AUTOMATION_DAY30_WEEKLY_CRON="20 6 * * 1"
export REVENUE_AUTOMATION_DAY30_RESPONSE_MAX_TASKS=10
export REVENUE_AUTOMATION_DAY30_REQUIRE_APPROVAL_GATES=true
export REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_RTS="rts-south-day1,rts-south-day1-exp-b"
export REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_RNG="rng-south-day1,rng-south-day1-exp-b"
export REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_AICF="aicf-south-day1,aicf-south-day1-exp-b"
export REVENUE_AUTOMATION_DAY30_WEEKLY_TEMPLATE_IDS="rts-south-day1,rts-south-day1-exp-b,rng-south-day1,rng-south-day1-exp-b,aicf-south-day1,aicf-south-day1-exp-b"

bash scripts/revenue-day30-scheduler-setup.sh
```

PowerShell equivalent:

```powershell
$env:GCP_PROJECT_ID = "leadflow-review"
$env:GCP_SCHEDULER_LOCATION = "us-central1"
$env:REVENUE_DAY30_SERVICE_URL = "https://ssrleadflowreview-<hash>-uc.a.run.app"
$env:REVENUE_DAY30_WORKER_TOKEN = "<token-from-secret-manager>"
$env:REVENUE_AUTOMATION_UID = "<firebase-uid>"
$env:REVENUE_AUTOMATION_TIME_ZONE = "America/Chicago"
$env:REVENUE_AUTOMATION_DAY30_CRON = "15 9 * * *"
$env:REVENUE_AUTOMATION_DAY30_WEEKLY_CRON = "20 6 * * 1"
$env:REVENUE_AUTOMATION_DAY30_RESPONSE_MAX_TASKS = "10"
$env:REVENUE_AUTOMATION_DAY30_REQUIRE_APPROVAL_GATES = "true"
$env:REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_RTS = "rts-south-day1,rts-south-day1-exp-b"
$env:REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_RNG = "rng-south-day1,rng-south-day1-exp-b"
$env:REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_AICF = "aicf-south-day1,aicf-south-day1-exp-b"
$env:REVENUE_AUTOMATION_DAY30_WEEKLY_TEMPLATE_IDS = "rts-south-day1,rts-south-day1-exp-b,rng-south-day1,rng-south-day1-exp-b,aicf-south-day1,aicf-south-day1-exp-b"

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/revenue-day30-scheduler-setup.ps1
```

Jobs created:
- `revenue-day30-rts-daily`
- `revenue-day30-rng-daily`
- `revenue-day30-aicf-daily`
- `revenue-day30-weekly-brain`

## Safety notes

- Keep `requireApprovalGates=true` unless explicitly approved otherwise.
- Day30 loop remains draft-first and does not auto-send outbound.
- Pricing/contracts/payment links remain approval-gated.
- Treat token mismatch as hard failure (403); rotate on suspected leakage.
