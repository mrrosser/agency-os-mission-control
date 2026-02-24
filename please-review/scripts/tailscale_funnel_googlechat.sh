#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOST="${OPENCLAW_HOST:-127.0.0.1}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
GOOGLECHAT_PATH="${GOOGLECHAT_PATH:-/googlechat}"

run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd tailscale
require_cmd curl

if ! run_as_root systemctl is-active --quiet tailscaled; then
  echo "tailscaled is not running. Start it with: sudo systemctl enable --now tailscaled" >&2
  exit 1
fi

if ! run_as_root tailscale status --json >/dev/null 2>&1; then
  echo "Tailscale is not authenticated. Run: sudo tailscale up" >&2
  exit 1
fi

if [[ "${GOOGLECHAT_PATH}" != /* ]]; then
  echo "GOOGLECHAT_PATH must start with / (got: ${GOOGLECHAT_PATH})" >&2
  exit 1
fi

if [[ "${GOOGLECHAT_PATH}" == "/" ]]; then
  echo "GOOGLECHAT_PATH cannot be /. Expose only the webhook path (example: /googlechat)." >&2
  exit 1
fi

if ! curl -sS --max-time 5 --output /dev/null "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}${GOOGLECHAT_PATH}"; then
  echo "Webhook target is not reachable at http://${OPENCLAW_HOST}:${OPENCLAW_PORT}${GOOGLECHAT_PATH}" >&2
  echo "Check gateway health and webhook path before enabling Funnel." >&2
  exit 1
fi

run_as_root tailscale funnel --bg --set-path "${GOOGLECHAT_PATH}" "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}${GOOGLECHAT_PATH}"
run_as_root tailscale funnel status

echo "Public webhook path enabled for Google Chat only: ${GOOGLECHAT_PATH}"
echo "Rollback: sudo tailscale funnel reset"
