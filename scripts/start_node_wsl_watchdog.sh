#!/usr/bin/env bash
set -euo pipefail

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
BACKOFF_SECONDS="${BACKOFF_SECONDS:-5}"
MAX_BACKOFF_SECONDS="${MAX_BACKOFF_SECONDS:-60}"

while true; do
  echo "[node-watchdog] starting node: ${GATEWAY_HOST}:${GATEWAY_PORT}"
  openclaw node run --host "$GATEWAY_HOST" --port "$GATEWAY_PORT" || true

  echo "[node-watchdog] node exited; retrying in ${BACKOFF_SECONDS}s"
  sleep "$BACKOFF_SECONDS"
  if [[ "$BACKOFF_SECONDS" -lt "$MAX_BACKOFF_SECONDS" ]]; then
    BACKOFF_SECONDS=$((BACKOFF_SECONDS * 2))
    if [[ "$BACKOFF_SECONDS" -gt "$MAX_BACKOFF_SECONDS" ]]; then
      BACKOFF_SECONDS="$MAX_BACKOFF_SECONDS"
    fi
  fi

done
