#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-}"
LOCATION="${GCP_SCHEDULER_LOCATION:-us-central1}"
SERVICE_URL="${SOCIAL_DISPATCH_SERVICE_URL:-${SOCIAL_DRAFT_BASE_URL:-${REVENUE_DAY30_BASE_URL:-${REVENUE_DAY2_BASE_URL:-${REVENUE_DAY1_BASE_URL:-}}}}}"
WORKER_TOKEN="${SOCIAL_DRAFT_WORKER_TOKEN:-${REVENUE_DAY30_WORKER_TOKEN:-${REVENUE_DAY2_WORKER_TOKEN:-${REVENUE_DAY1_WORKER_TOKEN:-}}}}"
UID="${SOCIAL_DISPATCH_UID:-${SOCIAL_DRAFT_UID:-${REVENUE_AUTOMATION_UID:-${REVENUE_DAY30_UID:-${REVENUE_DAY2_UID:-${REVENUE_DAY1_UID:-${VOICE_ACTIONS_DEFAULT_UID:-${SQUARE_WEBHOOK_DEFAULT_UID:-}}}}}}}}"
TIME_ZONE="${SOCIAL_DISPATCH_TIME_ZONE:-America/Chicago}"

DRAIN_CRON="${SOCIAL_DISPATCH_DRAIN_CRON:-*/15 * * * *}"
RETRY_CRON="${SOCIAL_DISPATCH_RETRY_CRON:-0 3 * * *}"
MAX_TASKS="${SOCIAL_DISPATCH_MAX_TASKS:-10}"
RETRY_MAX_TASKS="${SOCIAL_DISPATCH_RETRY_MAX_TASKS:-10}"
RETRY_ENABLED="${SOCIAL_DISPATCH_RETRY_ENABLED:-false}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Missing GCP_PROJECT_ID"
  exit 1
fi
if [[ -z "$SERVICE_URL" ]]; then
  echo "Missing SOCIAL_DISPATCH_SERVICE_URL (or SOCIAL_DRAFT_BASE_URL/REVENUE_DAY30_BASE_URL fallback)"
  exit 1
fi
if [[ -z "$WORKER_TOKEN" ]]; then
  echo "Missing SOCIAL_DRAFT_WORKER_TOKEN (or revenue worker token fallback)"
  exit 1
fi
if [[ -z "$UID" ]]; then
  echo "Missing SOCIAL_DISPATCH_UID (or SOCIAL_DRAFT_UID/revenue uid fallback)"
  exit 1
fi

job_upsert() {
  local name="$1"
  local cron="$2"
  local body="$3"
  local uri="${SERVICE_URL%/}/api/social/drafts/dispatch/worker-task"
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

drain_payload="{\"uid\":\"${UID}\",\"maxTasks\":${MAX_TASKS},\"retryFailed\":false,\"dryRun\":false}"
retry_payload="{\"uid\":\"${UID}\",\"maxTasks\":${RETRY_MAX_TASKS},\"retryFailed\":true,\"dryRun\":false}"

job_upsert "social-dispatch-drain" "$DRAIN_CRON" "$drain_payload"

case "${RETRY_ENABLED,,}" in
  true|1|yes)
    job_upsert "social-dispatch-retry-failed" "$RETRY_CRON" "$retry_payload"
    gcloud scheduler jobs resume social-dispatch-retry-failed --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1 || true
    ;;
  *)
    if gcloud scheduler jobs describe social-dispatch-retry-failed --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1; then
      gcloud scheduler jobs pause social-dispatch-retry-failed --location "$LOCATION" --project "$PROJECT_ID" >/dev/null 2>&1 || true
    fi
    ;;
esac

echo "Configured social dispatch scheduler jobs in ${TIME_ZONE}."
