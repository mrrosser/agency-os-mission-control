#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
LOCATION="${GCP_SCHEDULER_LOCATION:-us-central1}"
SERVICE_URL="${REVENUE_DAY2_SERVICE_URL:-${REVENUE_DAY1_SERVICE_URL:-}}"
WORKER_TOKEN="${REVENUE_DAY2_WORKER_TOKEN:-${REVENUE_DAY1_WORKER_TOKEN:-}}"
UID="${REVENUE_AUTOMATION_UID:-${REVENUE_DAY2_UID:-${REVENUE_DAY1_UID:-${VOICE_ACTIONS_DEFAULT_UID:-${SQUARE_WEBHOOK_DEFAULT_UID:-}}}}}"
TIME_ZONE="${REVENUE_AUTOMATION_TIME_ZONE:-America/Chicago}"

DAY2_CRON="${REVENUE_AUTOMATION_DAY2_CRON:-30 10 * * *}"
DAY2_MAX_TASKS="${REVENUE_AUTOMATION_DAY2_RESPONSE_MAX_TASKS:-10}"
DAY2_REQUIRE_APPROVAL_GATES="${REVENUE_AUTOMATION_DAY2_REQUIRE_APPROVAL_GATES:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID"
  exit 1
fi
if [[ -z "$SERVICE_URL" ]]; then
  echo "Missing REVENUE_DAY2_SERVICE_URL (or REVENUE_DAY1_SERVICE_URL fallback)"
  exit 1
fi
if [[ -z "$WORKER_TOKEN" ]]; then
  echo "Missing REVENUE_DAY2_WORKER_TOKEN (or REVENUE_DAY1_WORKER_TOKEN fallback)"
  exit 1
fi
if [[ -z "$UID" ]]; then
  echo "Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY2_UID/REVENUE_DAY1_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)"
  exit 1
fi

job_upsert() {
  local name="$1"
  local cron="$2"
  local body="$3"
  local uri="${SERVICE_URL%/}/api/revenue/day2/worker-task"
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
  job_name="revenue-day2-${business}-loop"
  payload="{\"uid\":\"${UID}\",\"templateIds\":[\"${template_id}\"],\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"processDueResponses\":true,\"responseLoopMaxTasks\":${DAY2_MAX_TASKS},\"requireApprovalGates\":${DAY2_REQUIRE_APPROVAL_GATES},\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1}"
  job_upsert "$job_name" "$DAY2_CRON" "$payload"
done

echo "Configured Day2 scheduler loop jobs for rts/rng/aicf in ${TIME_ZONE}."
