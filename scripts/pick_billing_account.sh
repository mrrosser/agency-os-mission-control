#!/usr/bin/env bash
set -euo pipefail

CORRELATION_ID="${CORRELATION_ID:-oc-$(date +%Y%m%d%H%M%S)}"
log() {
  local msg="$1"
  printf '{"ts":"%s","level":"info","correlationId":"%s","msg":"%s"}\n' "$(date -Is)" "$CORRELATION_ID" "$msg"
}

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found. Install Google Cloud SDK first." >&2
  exit 1
fi

if [[ -n "${BILLING_ACCOUNT_ID:-}" && "$BILLING_ACCOUNT_ID" != PLACEHOLDER_* ]]; then
  log "Using BILLING_ACCOUNT_ID from environment"
  bash infra/gcp/gcloud-commands.sh
  exit 0
fi

log "Listing billing accounts"
mapfile -t accounts < <(gcloud billing accounts list --format="value(ACCOUNT_ID,NAME,OPEN)")

if [[ ${#accounts[@]} -eq 0 ]]; then
  echo "ERROR: No billing accounts found. Verify access." >&2
  exit 1
fi

echo "Select a billing account:"
for i in "${!accounts[@]}"; do
  IFS=$'\t' read -r acct_id acct_name acct_open <<<"${accounts[$i]}"
  printf "%d) %s | %s | open=%s\n" "$((i+1))" "$acct_id" "$acct_name" "$acct_open"
done

read -r -p "Enter number: " selection
if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid selection." >&2
  exit 1
fi

index=$((selection-1))
if [[ $index -lt 0 || $index -ge ${#accounts[@]} ]]; then
  echo "ERROR: Selection out of range." >&2
  exit 1
fi

IFS=$'\t' read -r acct_id acct_name acct_open <<<"${accounts[$index]}"
log "Selected billing account ${acct_id} (${acct_name}) open=${acct_open}"

export BILLING_ACCOUNT_ID="$acct_id"
bash infra/gcp/gcloud-commands.sh
