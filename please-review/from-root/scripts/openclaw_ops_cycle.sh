#!/usr/bin/env bash
set -euo pipefail

RUN_ID="${RUN_ID:-oc-ops-$(date +%Y%m%d%H%M%S)}"
LOCK_FILE="${LOCK_FILE:-/tmp/openclaw-ops-cycle.lock}"
OPENCLAW_HOST="${OPENCLAW_HOST:-127.0.0.1}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
OPENCLAW_SERVICE_NAME="${OPENCLAW_SERVICE_NAME:-openclaw-gateway}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-docker/.env}"
DO_UPDATE="${DO_UPDATE:-false}"
TAILSCALE_VALIDATE="${TAILSCALE_VALIDATE:-true}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  local level="$1"
  local msg="$2"
  printf '{"ts":"%s","level":"%s","runId":"%s","msg":"%s"}\n' "$(date -Is)" "${level}" "${RUN_ID}" "${msg}"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "error" "Missing required command: $1"
    exit 1
  fi
}

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${COMPOSE_ENV_FILE}" "$@"
}

require_cmd docker
require_cmd curl
require_cmd flock

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "warn" "Another openclaw_ops_cycle run is active; skipping this run."
  exit 0
fi

cd "${REPO_ROOT}"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  log "error" "Compose file not found at ${REPO_ROOT}/${COMPOSE_FILE}"
  exit 1
fi
if [[ ! -f "${COMPOSE_ENV_FILE}" ]]; then
  log "error" "Compose env file not found at ${REPO_ROOT}/${COMPOSE_ENV_FILE}"
  exit 1
fi

if is_true "${DO_UPDATE}"; then
  log "info" "Pulling latest image for ${OPENCLAW_SERVICE_NAME}"
  compose pull "${OPENCLAW_SERVICE_NAME}"
  log "info" "Recreating ${OPENCLAW_SERVICE_NAME}"
  compose up -d "${OPENCLAW_SERVICE_NAME}"
fi

log "info" "Checking compose status"
compose ps

if ! docker ps --format '{{.Names}}' | grep -q "^${OPENCLAW_SERVICE_NAME}$"; then
  log "error" "Container ${OPENCLAW_SERVICE_NAME} is not running."
  exit 1
fi

if ! curl -fsS --max-time 8 -I "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}" >/dev/null; then
  log "error" "Gateway is unreachable at http://${OPENCLAW_HOST}:${OPENCLAW_PORT}"
  exit 1
fi

if ! docker exec -i "${OPENCLAW_SERVICE_NAME}" openclaw health >/dev/null; then
  log "error" "openclaw health check failed inside ${OPENCLAW_SERVICE_NAME}"
  exit 1
fi
log "info" "Gateway health check passed"

if is_true "${TAILSCALE_VALIDATE}" && command -v tailscale >/dev/null 2>&1; then
  if tailscale serve status >/dev/null 2>&1; then
    log "info" "tailscale serve status check passed"
  else
    log "warn" "tailscale serve status check failed"
  fi
fi

log "info" "openclaw_ops_cycle completed successfully"
