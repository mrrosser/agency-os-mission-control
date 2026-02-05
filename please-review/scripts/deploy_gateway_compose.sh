#!/usr/bin/env bash
set -euo pipefail

CORRELATION_ID="${CORRELATION_ID:-oc-$(date +%Y%m%d%H%M%S)}"
log() {
  local msg="$1"
  printf '{"ts":"%s","level":"info","correlationId":"%s","msg":"%s"}\n' "$(date -Is)" "$CORRELATION_ID" "$msg"
}

if [[ ! -f docker/.env ]]; then
  echo "Missing docker/.env. Copy docker/.env.template first." >&2
  exit 1
fi

log "Starting OpenClaw gateway via Docker Compose"
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build

log "Gateway status"
docker compose -f docker/docker-compose.yml --env-file docker/.env ps

log "Health check"
docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw health

log "Security audit (deep)"
docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw security audit --deep
