#!/usr/bin/env bash
set -euo pipefail

# Start/refresh gmail webhook runners (background)
docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mrosser@rossernftgallery.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mrosser \
  --subscription gog-gmail-watch-push-mrosser \
  --bind 0.0.0.0 \
  --port 8788 \
  --path /gmail-pubsub-mrosser \
  --tailscale off

docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mcool4444@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mcool4444 \
  --subscription gog-gmail-watch-push-mcool4444 \
  --bind 0.0.0.0 \
  --port 8789 \
  --path /gmail-pubsub-mcool4444 \
  --tailscale off

docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcus@aicofoundry.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcus \
  --subscription gog-gmail-watch-push-marcus \
  --bind 0.0.0.0 \
  --port 8790 \
  --path /gmail-pubsub-marcus \
  --tailscale off

docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcuslrosser@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcuslrosser \
  --subscription gog-gmail-watch-push-marcuslrosser \
  --bind 0.0.0.0 \
  --port 8791 \
  --path /gmail-pubsub-marcuslrosser \
  --tailscale off

# Show running webhook processes
sleep 2
docker exec openclaw-gateway bash -lc 'ps -ef | grep "openclaw webhooks gmail run" | grep -v grep' || true
