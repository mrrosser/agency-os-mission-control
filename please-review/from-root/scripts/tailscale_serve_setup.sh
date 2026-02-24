#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOST="${OPENCLAW_HOST:-127.0.0.1}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
TAILSCALE_HTTPS_PORT="${TAILSCALE_HTTPS_PORT:-8443}"

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
require_cmd jq

if ! run_as_root systemctl is-active --quiet tailscaled; then
  echo "tailscaled is not running. Start it with: sudo systemctl enable --now tailscaled" >&2
  exit 1
fi

status_json="$(run_as_root tailscale status --json 2>/dev/null || true)"
if [[ -z "${status_json}" ]]; then
  echo "Tailscale is not authenticated. Run: sudo tailscale up" >&2
  exit 1
fi

dns_name="$(printf '%s' "${status_json}" | jq -r '.Self.DNSName // ""' | sed 's/\.$//')"
if [[ -z "${dns_name}" ]]; then
  echo "Unable to determine Tailscale DNS name. Run: sudo tailscale up" >&2
  exit 1
fi

if ! curl -fsS --max-time 5 -I "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}" >/dev/null; then
  echo "OpenClaw gateway is not reachable at http://${OPENCLAW_HOST}:${OPENCLAW_PORT}" >&2
  echo "Check container/service health before running this setup." >&2
  exit 1
fi

run_as_root tailscale serve --bg --https "${TAILSCALE_HTTPS_PORT}" "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}"
run_as_root tailscale serve status

echo "OpenClaw Control UI (tailnet-only): https://${dns_name}:${TAILSCALE_HTTPS_PORT}/"
echo "Rollback: sudo tailscale serve reset"
