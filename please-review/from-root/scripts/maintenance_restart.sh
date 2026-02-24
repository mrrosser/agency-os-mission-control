#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENABLE_GOOGLECHAT_FUNNEL="${ENABLE_GOOGLECHAT_FUNNEL:-true}"
ENABLE_GMAIL_PUBSUB_FUNNELS="${ENABLE_GMAIL_PUBSUB_FUNNELS:-false}"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

log() {
  printf "[%s] %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

log "A1 maintenance: restart native OpenClaw + Gmail watchers"

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

# Stop Docker gateway if still running (avoid port conflicts)
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' | grep -q '^openclaw-gateway$'; then
    log "Stopping docker openclaw-gateway"
    docker stop openclaw-gateway || true
  fi
fi

if ! command -v openclaw >/dev/null 2>&1; then
  log "ERROR: openclaw not found in PATH"
  exit 1
fi

# Ensure OpenClaw state dir exists and is owned by marcu
mkdir -p /home/marcu/.openclaw
chown -R marcu:marcu /home/marcu/.openclaw

# Restart services
systemctl daemon-reload
systemctl restart openclaw-gateway.service

for acct in mrosser mcool4444 marcus marcuslrosser; do
  if systemctl list-unit-files | grep -q "openclaw-gmail@${acct}.service"; then
    systemctl restart "openclaw-gmail@${acct}.service" || true
  fi
done

if command -v curl >/dev/null 2>&1; then
  for i in {1..24}; do
    if curl -fsS --max-time 5 -I http://127.0.0.1:18789 >/dev/null 2>&1; then
      break
    fi
    if [[ "${i}" -eq 24 ]]; then
      log "ERROR: gateway did not become reachable on 127.0.0.1:18789"
      exit 1
    fi
    sleep 2
  done
fi

# Reassert Serve and only required Funnel routes
if command -v tailscale >/dev/null 2>&1; then
  bash "${SCRIPT_DIR}/tailscale_serve_setup.sh"

  if is_true "${ENABLE_GOOGLECHAT_FUNNEL}"; then
    bash "${SCRIPT_DIR}/tailscale_funnel_googlechat.sh"
  else
    log "Skipping Google Chat Funnel (ENABLE_GOOGLECHAT_FUNNEL=${ENABLE_GOOGLECHAT_FUNNEL})"
  fi

  if is_true "${ENABLE_GMAIL_PUBSUB_FUNNELS}"; then
    tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://127.0.0.1:8788
    tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://127.0.0.1:8789
    tailscale funnel --bg --set-path /gmail-pubsub-marcus http://127.0.0.1:8790
    tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://127.0.0.1:8791
  else
    log "Skipping Gmail Funnel routes (ENABLE_GMAIL_PUBSUB_FUNNELS=${ENABLE_GMAIL_PUBSUB_FUNNELS})"
  fi
fi

# Quick checks (GET should be 404/405; 502 indicates dead backend)
log "Health check: gateway + mrosser webhook"
if command -v curl >/dev/null 2>&1; then
  curl -s -o /dev/null -w "googlechat %{http_code}\n" http://127.0.0.1:18789/googlechat || true
  curl -s -o /dev/null -w "mrosser %{http_code}\n" http://127.0.0.1:8788/gmail-pubsub-mrosser || true
fi

systemctl --no-pager status openclaw-gateway.service
systemctl --no-pager status openclaw-gmail@mrosser.service || true
