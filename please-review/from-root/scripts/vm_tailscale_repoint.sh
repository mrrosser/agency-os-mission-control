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

bash "${SCRIPT_DIR}/tailscale_serve_setup.sh"

if is_true "${ENABLE_GOOGLECHAT_FUNNEL}"; then
  bash "${SCRIPT_DIR}/tailscale_funnel_googlechat.sh"
else
  echo "Skipping Google Chat Funnel (ENABLE_GOOGLECHAT_FUNNEL=${ENABLE_GOOGLECHAT_FUNNEL})"
fi

if is_true "${ENABLE_GMAIL_PUBSUB_FUNNELS}"; then
  sudo tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://127.0.0.1:8788
  sudo tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://127.0.0.1:8789
  sudo tailscale funnel --bg --set-path /gmail-pubsub-marcus http://127.0.0.1:8790
  sudo tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://127.0.0.1:8791
else
  echo "Skipping Gmail Funnel routes (ENABLE_GMAIL_PUBSUB_FUNNELS=${ENABLE_GMAIL_PUBSUB_FUNNELS})"
fi

sudo tailscale serve status || true
sudo tailscale funnel status
