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

json_array_from_csv() {
  local csv="$1"
  local output="["
  local first=1
  IFS=',' read -ra raw_items <<<"$csv"
  for raw_item in "${raw_items[@]}"; do
    local item
    item="$(echo "$raw_item" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -z "$item" ]] && continue
    if [[ "$first" -eq 0 ]]; then
      output+=","
    fi
    output+="\"$item\""
    first=0
  done
  output+="]"
  echo "$output"
}

template_ids_json_for_business() {
  local business="$1"
  local default_template="$2"
  local business_upper
  business_upper="$(echo "$business" | tr '[:lower:]' '[:upper:]')"
  local override_var="REVENUE_AUTOMATION_DAY30_TEMPLATE_IDS_${business_upper}"
  local override="${!override_var:-}"
  if [[ -z "$override" ]]; then
    local fallback_var="REVENUE_AUTOMATION_TEMPLATE_IDS_${business_upper}"
    override="${!fallback_var:-}"
  fi

  if [[ -z "$override" ]]; then
    echo "[\"${default_template}\"]"
    return
  fi

  local parsed
  parsed="$(json_array_from_csv "$override")"
  if [[ "$parsed" == "[]" ]]; then
    echo "[\"${default_template}\"]"
    return
  fi
  echo "$parsed"
}

weekly_template_ids_json() {
  local weekly_override="${REVENUE_AUTOMATION_DAY30_WEEKLY_TEMPLATE_IDS:-}"
  if [[ -n "$weekly_override" ]]; then
    local parsed
    parsed="$(json_array_from_csv "$weekly_override")"
    if [[ "$parsed" != "[]" ]]; then
      echo "$parsed"
      return
    fi
  fi

  local merged="["
  local first=1
  for business in rts rng aicf; do
    local template_ids_json
    template_ids_json="$(template_ids_json_for_business "$business" "${TEMPLATE_BY_BUSINESS[$business]}")"
    local inner="${template_ids_json#[}"
    inner="${inner%]}"
    if [[ -z "$inner" ]]; then
      continue
    fi
    if [[ "$first" -eq 0 ]]; then
      merged+=","
    fi
    merged+="$inner"
    first=0
  done
  merged+="]"
  echo "$merged"
}

for business in rts rng aicf; do
  template_id="${TEMPLATE_BY_BUSINESS[$business]}"
  template_ids_json="$(template_ids_json_for_business "$business" "$template_id")"
  job_name="revenue-day30-${business}-daily"
  payload="{\"uid\":\"${UID}\",\"templateIds\":${template_ids_json},\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"processDueResponses\":true,\"responseLoopMaxTasks\":${DAY30_MAX_TASKS},\"requireApprovalGates\":${DAY30_REQUIRE_APPROVAL_GATES},\"runWeeklyKpi\":false,\"runServiceLab\":false,\"runCloserQueue\":true,\"runRevenueMemory\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1,\"serviceCandidateLimit\":5,\"closerQueueLookbackHours\":72,\"closerQueueLimit\":40,\"memoryLookbackDays\":30}"
  job_upsert "$job_name" "$DAY30_CRON" "$payload"
done

weekly_template_ids_json="$(weekly_template_ids_json)"
weekly_payload="{\"uid\":\"${UID}\",\"templateIds\":${weekly_template_ids_json},\"dryRun\":false,\"forceRun\":false,\"timeZone\":\"${TIME_ZONE}\",\"autoQueueFollowups\":true,\"processDueResponses\":true,\"responseLoopMaxTasks\":${DAY30_MAX_TASKS},\"requireApprovalGates\":${DAY30_REQUIRE_APPROVAL_GATES},\"runWeeklyKpi\":true,\"runServiceLab\":true,\"runCloserQueue\":true,\"runRevenueMemory\":true,\"followupDelayHours\":48,\"followupMaxLeads\":25,\"followupSequence\":1,\"serviceCandidateLimit\":5,\"closerQueueLookbackHours\":72,\"closerQueueLimit\":40,\"memoryLookbackDays\":30}"
job_upsert "revenue-day30-weekly-brain" "$DAY30_WEEKLY_CRON" "$weekly_payload"

echo "Configured Day30 scheduler jobs (daily per business + weekly brain loop) in ${TIME_ZONE}."
