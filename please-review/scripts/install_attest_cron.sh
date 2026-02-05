#!/usr/bin/env bash
set -euo pipefail

VM_NAME="${VM_NAME:-ai-hell-mary-gateway}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"

LOG_PATH="${LOG_PATH:-$HOME/openclaw-attest.log}"
CRON_SCHEDULE="${CRON_SCHEDULE:-*/5 * * * *}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "ERROR: crontab not found." >&2
  exit 1
fi

CRON_CMD="bash $(pwd)/scripts/attest_gateway_local.sh >> $LOG_PATH 2>&1"

# Remove any previous entries for this script
(crontab -l 2>/dev/null | grep -v "attest_gateway_local.sh" || true) | crontab -

# Install new entry
( crontab -l 2>/dev/null; echo "$CRON_SCHEDULE $CRON_CMD" ) | crontab -

echo "Installed cron: $CRON_SCHEDULE $CRON_CMD"

