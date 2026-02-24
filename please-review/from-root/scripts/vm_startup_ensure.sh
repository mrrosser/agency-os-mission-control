#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENABLE_GOOGLECHAT_FUNNEL="${ENABLE_GOOGLECHAT_FUNNEL:-true}"
ENABLE_GMAIL_PUBSUB_FUNNELS="${ENABLE_GMAIL_PUBSUB_FUNNELS:-false}"

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

# Wait for docker and container
for i in {1..60}; do
  if docker ps --format '{{.Names}}' | grep -q '^openclaw-gateway$'; then
    break
  fi
  sleep 5

done

for i in {1..60}; do
  if curl -fsS --max-time 5 -I http://127.0.0.1:18789 >/dev/null 2>&1; then
    break
  fi
  if [[ "${i}" -eq 60 ]]; then
    echo "OpenClaw gateway did not become reachable on 127.0.0.1:18789" >&2
    exit 1
  fi
  sleep 2
done

bash "${SCRIPT_DIR}/tailscale_serve_setup.sh"

if is_true "${ENABLE_GOOGLECHAT_FUNNEL}"; then
  bash "${SCRIPT_DIR}/tailscale_funnel_googlechat.sh"
else
  echo "Skipping Google Chat Funnel (ENABLE_GOOGLECHAT_FUNNEL=${ENABLE_GOOGLECHAT_FUNNEL})"
fi

if is_true "${ENABLE_GMAIL_PUBSUB_FUNNELS}"; then
  sudo -n tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://127.0.0.1:8788
  sudo -n tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://127.0.0.1:8789
  sudo -n tailscale funnel --bg --set-path /gmail-pubsub-marcus http://127.0.0.1:8790
  sudo -n tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://127.0.0.1:8791
else
  echo "Skipping Gmail Funnel routes (ENABLE_GMAIL_PUBSUB_FUNNELS=${ENABLE_GMAIL_PUBSUB_FUNNELS})"
fi

# Ensure Gmail webhook runners are up
sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mrosser@rossernftgallery.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mrosser \
  --subscription gog-gmail-watch-push-mrosser \
  --bind 0.0.0.0 \
  --port 8788 \
  --path /gmail-pubsub-mrosser \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mcool4444@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mcool4444 \
  --subscription gog-gmail-watch-push-mcool4444 \
  --bind 0.0.0.0 \
  --port 8789 \
  --path /gmail-pubsub-mcool4444 \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcus@aicofoundry.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcus \
  --subscription gog-gmail-watch-push-marcus \
  --bind 0.0.0.0 \
  --port 8790 \
  --path /gmail-pubsub-marcus \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcuslrosser@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcuslrosser \
  --subscription gog-gmail-watch-push-marcuslrosser \
  --bind 0.0.0.0 \
  --port 8791 \
  --path /gmail-pubsub-marcuslrosser \
  --tailscale off
