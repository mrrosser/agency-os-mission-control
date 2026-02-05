#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Installing OS deps inside container..."
docker exec -u 0 openclaw-gateway bash -lc 'apt-get update && apt-get install -y --no-install-recommends build-essential ffmpeg golang ripgrep tmux'

echo "[2/4] Installing npm globals (skills)..."
docker exec -u 0 openclaw-gateway bash -lc 'npm install -g @steipete/bird clawhub mcporter @steipete/oracle'

echo "[3/4] Installing go tools (skills)..."
docker exec -u 0 openclaw-gateway bash -lc 'export GOBIN=/usr/local/bin; go version; go install github.com/Hyaxia/blogwatcher/cmd/blogwatcher@latest; go install github.com/steipete/blucli/cmd/blu@latest; go install github.com/steipete/eightctl/cmd/eightctl@latest; go install github.com/steipete/sonoscli/cmd/sonos@latest'

echo "[4/4] Installing plugin deps (otel + lancedb)..."
docker exec -u 0 openclaw-gateway bash -lc 'npm install --prefix /usr/lib/node_modules/openclaw @opentelemetry/api @lancedb/lancedb'

echo "Restarting gateway..."
docker compose -f ~/ai-hell-mary/docker/docker-compose.yml --env-file ~/ai-hell-mary/docker/.env up -d --force-recreate
