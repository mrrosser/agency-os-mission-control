#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
LOCATION="${GCP_SCHEDULER_LOCATION:-us-central1}"
SERVICE_URL="${REVENUE_DAY1_SERVICE_URL:-}"
WORKER_TOKEN="${REVENUE_DAY1_WORKER_TOKEN:-}"
UID="${REVENUE_AUTOMATION_UID:-${REVENUE_DAY1_UID:-${VOICE_ACTIONS_DEFAULT_UID:-${SQUARE_WEBHOOK_DEFAULT_UID:-}}}}"
TIME_ZONE="${REVENUE_AUTOMATION_TIME_ZONE:-America/Chicago}"

START_CRON="${REVENUE_AUTOMATION_START_CRON:-0 8 * * *}"
SEED_D2_CRON="${REVENUE_AUTOMATION_SEED_CRON_D2:-${REVENUE_AUTOMATION_SEED_CRON:-0 10 * * *}}"
SEED_D5_CRON="${REVENUE_AUTOMATION_SEED_CRON_D5:-20 10 * * *}"
SEED_D10_CRON="${REVENUE_AUTOMATION_SEED_CRON_D10:-40 10 * * *}"
SEED_D14_CRON="${REVENUE_AUTOMATION_SEED_CRON_D14:-0 11 * * *}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID"
  exit 1
fi
if [[ -z "$SERVICE_URL" ]]; then
  echo "Missing REVENUE_DAY1_SERVICE_URL (ex: https://ssrleadflowreview-xxxx-uc.a.run.app)"
  exit 1
fi
if [[ -z "$WORKER_TOKEN" ]]; then
  echo "Missing REVENUE_DAY1_WORKER_TOKEN"
  exit 1
fi
if [[ -z "$UID" ]]; then
  echo "Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY1_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)"
  exit 1
fi

job_upsert() {
  local name="$1"
  local cron="$2"
  local body="$3"
  local uri="${SERVICE_URL%/}/api/revenue/day1/worker-task"
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

  start_job="revenue-day1-${business}-start"
  start_payload="{\"uid\":\"${UID}\",\"templateId\":\"${template_id}\",\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1}"
  job_upsert "$start_job" "$START_CRON" "$start_payload"

  seed_job_d2="revenue-day1-${business}-followup-seed"
  seed_payload_d2="{\"uid\":\"${UID}\",\"templateId\":\"${template_id}\",\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1}"
  job_upsert "$seed_job_d2" "$SEED_D2_CRON" "$seed_payload_d2"

  seed_job_d5="revenue-day1-${business}-followup-seed-d5"
  seed_payload_d5="{\"uid\":\"${UID}\",\"templateId\":\"${template_id}\",\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"followupDelayHours\":120,\"followupMaxLeads\":25,\"followupSequence\":2}"
  job_upsert "$seed_job_d5" "$SEED_D5_CRON" "$seed_payload_d5"

  seed_job_d10="revenue-day1-${business}-followup-seed-d10"
  seed_payload_d10="{\"uid\":\"${UID}\",\"templateId\":\"${template_id}\",\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"followupDelayHours\":240,\"followupMaxLeads\":25,\"followupSequence\":3}"
  job_upsert "$seed_job_d10" "$SEED_D10_CRON" "$seed_payload_d10"

  seed_job_d14="revenue-day1-${business}-followup-seed-d14"
  seed_payload_d14="{\"uid\":\"${UID}\",\"templateId\":\"${template_id}\",\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"followupDelayHours\":336,\"followupMaxLeads\":25,\"followupSequence\":4}"
  job_upsert "$seed_job_d14" "$SEED_D14_CRON" "$seed_payload_d14"
done

echo "Configured Day1 scheduler jobs (start + D+2/D+5/D+10/D+14 followup seeds) for rts/rng/aicf in ${TIME_ZONE}."
