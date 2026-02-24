#!/usr/bin/env bash
set -euo pipefail

TAILSCALE_SSH_ENABLED="${TAILSCALE_SSH_ENABLED:-true}"
ADMIN_SSH_USER="${ADMIN_SSH_USER:-marcu}"

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

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_cmd tailscale
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

if is_true "${TAILSCALE_SSH_ENABLED}"; then
  run_as_root tailscale set --ssh=true
  expected_state="true"
else
  run_as_root tailscale set --ssh=false
  expected_state="false"
fi

status_json="$(run_as_root tailscale status --json)"
ssh_enabled="$(printf '%s' "${status_json}" | jq -r '.Self.SSHEnabled // false')"
if [[ "${ssh_enabled}" != "${expected_state}" ]]; then
  echo "Failed to enforce Tailscale SSH state (expected ${expected_state}, got ${ssh_enabled})." >&2
  exit 1
fi

echo "Tailscale SSH enabled: ${ssh_enabled}"
echo "Admin shell (tailnet): ssh ${ADMIN_SSH_USER}@${dns_name}"
echo "Rollback: sudo tailscale set --ssh=false"
