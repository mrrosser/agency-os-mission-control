#!/usr/bin/env bash
set -euo pipefail

CONTAINER_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' openclaw-gateway)

echo "Container IP: $CONTAINER_IP"

if ! command -v ss >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y iproute2 procps
fi

echo "Listening ports:"
ss -ltnp | grep -E ":8788|:8789|:8790|:8791" || true

check() {
  local name="$1" port="$2" path="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://${CONTAINER_IP}:${port}${path}")
  echo "${name} -> HTTP ${code}"
}

check "mrosser" 8788 /gmail-pubsub-mrosser
check "mcool4444" 8789 /gmail-pubsub-mcool4444
check "marcus" 8790 /gmail-pubsub-marcus
check "marcuslrosser" 8791 /gmail-pubsub-marcuslrosser
