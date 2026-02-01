#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[attest]"

if ! command -v docker >/dev/null 2>&1; then
  echo "$LOG_PREFIX ERROR: docker not found" >&2
  exit 1
fi

docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw health

docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw status
