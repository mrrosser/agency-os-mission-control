#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

log() {
  printf "[%s] %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

log "A1 maintenance: restart native OpenClaw + Gmail watchers"

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

# Repoint funnel to native ports (localhost)
if command -v tailscale >/dev/null 2>&1; then
  tailscale funnel --bg --set-path /googlechat http://127.0.0.1:18789/googlechat
  tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://127.0.0.1:8788
  tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://127.0.0.1:8789
  tailscale funnel --bg --set-path /gmail-pubsub-marcus http://127.0.0.1:8790
  tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://127.0.0.1:8791
fi

# Quick checks (GET should be 404/405; 502 indicates dead backend)
log "Health check: gateway + mrosser webhook"
if command -v curl >/dev/null 2>&1; then
  curl -s -o /dev/null -w "googlechat %{http_code}\n" http://127.0.0.1:18789/googlechat || true
  curl -s -o /dev/null -w "mrosser %{http_code}\n" http://127.0.0.1:8788/gmail-pubsub-mrosser || true
fi

systemctl --no-pager status openclaw-gateway.service
systemctl --no-pager status openclaw-gmail@mrosser.service || true
