#!/usr/bin/env bash
set -euo pipefail

ROOT="${OPENCLAW_ROOT:-$HOME/ai-hell-mary}"
COMPOSE_FILE="$ROOT/docker/docker-compose.yml"
ENV_FILE="$ROOT/docker/.env"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate
