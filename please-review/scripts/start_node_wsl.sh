#!/usr/bin/env bash
set -euo pipefail

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

openclaw node run --host "$GATEWAY_HOST" --port "$GATEWAY_PORT"
