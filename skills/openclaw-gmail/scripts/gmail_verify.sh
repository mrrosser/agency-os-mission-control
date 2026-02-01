#!/usr/bin/env bash
set -euo pipefail

docker exec openclaw-gateway gcloud --version

docker exec openclaw-gateway gog --version

docker exec openclaw-gateway openclaw status

echo "Hint: OPENCLAW_SKIP_GMAIL_WATCHER should be unset for built-in auto watcher."
