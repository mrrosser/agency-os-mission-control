#!/usr/bin/env bash
set -euo pipefail

# Re-auth all managed Google mailboxes for native OpenClaw triage.
# Run as marcu:
#   sudo -i -u marcu bash /home/marcu/ai-hell-mary/scripts/native_reauth_google_workspace.sh

if [[ "$(id -un)" != "marcu" ]]; then
  echo "Run this script as marcu:"
  echo "  sudo -i -u marcu bash /home/marcu/ai-hell-mary/scripts/native_reauth_google_workspace.sh"
  exit 1
fi

BASE_SERVICES="${BASE_SERVICES:-gmail,calendar,drive,contacts,people}"
INCLUDE_CHAT_SCOPE="${INCLUDE_CHAT_SCOPE:-1}"
SERVICES="$BASE_SERVICES"
if [[ "$INCLUDE_CHAT_SCOPE" == "1" ]]; then
  SERVICES="${BASE_SERVICES},chat"
fi

ACCOUNTS=(
  "mrosser@rossernftgallery.com"
  "mcool4444@gmail.com"
  "marcus@aicofoundry.com"
  "marcuslrosser@gmail.com"
)

echo "Workspace OAuth reauth start"
echo "services=${SERVICES}"
echo

for account in "${ACCOUNTS[@]}"; do
  echo "== Re-auth: ${account} =="
  if ! gog auth login --account "${account}" --client default --services "${SERVICES}"; then
    if [[ "${SERVICES}" == *",chat"* ]]; then
      echo "chat scope alias failed for ${account}; retrying without chat scope"
      gog auth login --account "${account}" --client default --services "${BASE_SERVICES}"
    else
      echo "auth failed for ${account}"
      exit 1
    fi
  fi
  echo
done

echo "== Auth list =="
gog auth list --plain || true
echo

echo "== Trigger triage once =="
sudo systemctl start openclaw-email-triage.service || true
sudo journalctl -u openclaw-email-triage.service -n 160 --no-pager | \
  grep -E "triage.done|needsReauth|chat.digest_failed|draft.created|calendarBooked|calendarConflict" || true

echo
echo "Done."
