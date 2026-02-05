#!/usr/bin/env bash
set -euo pipefail

echo "== Docker containers =="
docker ps

echo
echo "== Recent gateway logs =="
docker logs --since 10m openclaw-gateway | tail -n 200

echo
echo "== OpenClaw status (best-effort) =="
docker exec openclaw-gateway openclaw status || true
