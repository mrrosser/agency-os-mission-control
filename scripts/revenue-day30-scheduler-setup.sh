#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
LOCATION="${GCP_SCHEDULER_LOCATION:-us-central1}"
SERVICE_URL="${REVENUE_DAY30_SERVICE_URL:-${REVENUE_DAY2_SERVICE_URL:-${REVENUE_DAY1_SERVICE_URL:-}}}"
WORKER_TOKEN="${REVENUE_DAY30_WORKER_TOKEN:-${REVENUE_DAY2_WORKER_TOKEN:-${REVENUE_DAY1_WORKER_TOKEN:-}}}"
UID="${REVENUE_AUTOMATION_UID:-${REVENUE_DAY30_UID:-${REVENUE_DAY2_UID:-${REVENUE_DAY1_UID:-${VOICE_ACTIONS_DEFAULT_UID:-${SQUARE_WEBHOOK_DEFAULT_UID:-}}}}}}"
TIME_ZONE="${REVENUE_AUTOMATION_TIME_ZONE:-America/Chicago}"

DAY30_CRON="${REVENUE_AUTOMATION_DAY30_CRON:-15 9 * * *}"
DAY30_WEEKLY_CRON="${REVENUE_AUTOMATION_DAY30_WEEKLY_CRON:-20 6 * * 1}"
DAY30_MAX_TASKS="${REVENUE_AUTOMATION_DAY30_RESPONSE_MAX_TASKS:-10}"
DAY30_REQUIRE_APPROVAL_GATES="${REVENUE_AUTOMATION_DAY30_REQUIRE_APPROVAL_GATES:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID"
  exit 1
fi
if [[ -z "$SERVICE_URL" ]]; then
  echo "Missing REVENUE_DAY30_SERVICE_URL (or REVENUE_DAY2_SERVICE_URL/REVENUE_DAY1_SERVICE_URL fallback)"
  exit 1
fi
if [[ -z "$WORKER_TOKEN" ]]; then
  echo "Missing REVENUE_DAY30_WORKER_TOKEN (or REVENUE_DAY2_WORKER_TOKEN/REVENUE_DAY1_WORKER_TOKEN fallback)"
  exit 1
fi
if [[ -z "$UID" ]]; then
  echo "Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID fallback)"
  exit 1
fi

job_upsert() {
  local name="$1"
  local cron="$2"
  local body="$3"
  local uri="${SERVICE_URL%/}/api/revenue/day30/worker-task"
  local body_file
  body_file="$(mktemp)"
  trap 'rm -f "$body_file"' RETURN
  printf '%s' "$body" >"$body_file"

  if gcloud scheduler jobs describe "$name" --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" \
      --location "$LOCATION" \
      --project "$PROJECT_ID" \
      --schedule "$cron" \
      --time-zone "$TIME_ZONE" \
      --uri "$uri" \
      --http-method POST \
      --update-headers "Content-Type=application/json,Authorization=Bearer ${WORKER_TOKEN}" \
      --message-body-from-file "$body_file"
  else
    gcloud scheduler jobs create http "$name" \
      --location "$LOCATION" \
      --project "$PROJECT_ID" \
      --schedule "$cron" \
      --time-zone "$TIME_ZONE" \
      --uri "$uri" \
      --http-method POST \
      --headers "Content-Type=application/json,Authorization=Bearer ${WORKER_TOKEN}" \
      --message-body-from-file "$body_file"
  fi
}

declare -A TEMPLATE_BY_BUSINESS=(
  [rts]="rts-south-day1"
  [rng]="rng-south-day1"
  [aicf]="aicf-south-day1"
)

for business in rts rng aicf; do
  template_id="${TEMPLATE_BY_BUSINESS[$business]}"
  job_name="revenue-day30-${business}-daily"
  payload="{\"uid\":\"${UID}\",\"templateIds\":[\"${template_id}\"],\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"processDueResponses\":true,\"responseLoopMaxTasks\":${DAY30_MAX_TASKS},\"requireApprovalGates\":${DAY30_REQUIRE_APPROVAL_GATES},\"runWeeklyKpi\":false,\"runServiceLab\":false,\"runCloserQueue\":true,\"runRevenueMemory\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1,\"serviceCandidateLimit\":5,\"closerQueueLookbackHours\":72,\"closerQueueLimit\":40,\"memoryLookbackDays\":30}"
  job_upsert "$job_name" "$DAY30_CRON" "$payload"
done

weekly_payload="{\"uid\":\"${UID}\",\"templateIds\":[\"rts-south-day1\",\"rng-south-day1\",\"aicf-south-day1\"],\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"processDueResponses\":true,\"responseLoopMaxTasks\":${DAY30_MAX_TASKS},\"requireApprovalGates\":${DAY30_REQUIRE_APPROVAL_GATES},\"runWeeklyKpi\":true,\"runServiceLab\":true,\"runCloserQueue\":true,\"runRevenueMemory\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1,\"serviceCandidateLimit\":5,\"closerQueueLookbackHours\":72,\"closerQueueLimit\":40,\"memoryLookbackDays\":30}"
job_upsert "revenue-day30-weekly-brain" "$DAY30_WEEKLY_CRON" "$weekly_payload"

echo "Configured Day30 scheduler jobs (daily per business + weekly brain loop) in ${TIME_ZONE}."
