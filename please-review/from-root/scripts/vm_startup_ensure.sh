#!/usr/bin/env bash
set -euo pipefail

# Wait for docker and container
for i in {1..60}; do
  if docker ps --format '{{.Names}}' | grep -q '^openclaw-gateway$'; then
    break
  fi
  sleep 5

done

CONTAINER_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' openclaw-gateway)

# Public funnels for Google Chat + Gmail push
sudo -n tailscale funnel --bg --set-path /googlechat http://$CONTAINER_IP:18789
sudo -n tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://$CONTAINER_IP:8788
sudo -n tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://$CONTAINER_IP:8789
sudo -n tailscale funnel --bg --set-path /gmail-pubsub-marcus http://$CONTAINER_IP:8790
sudo -n tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://$CONTAINER_IP:8791

# Ensure Gmail webhook runners are up
sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mrosser@rossernftgallery.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mrosser \
  --subscription gog-gmail-watch-push-mrosser \
  --bind 0.0.0.0 \
  --port 8788 \
  --path /gmail-pubsub-mrosser \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account mcool4444@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-mcool4444 \
  --subscription gog-gmail-watch-push-mcool4444 \
  --bind 0.0.0.0 \
  --port 8789 \
  --path /gmail-pubsub-mcool4444 \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcus@aicofoundry.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcus \
  --subscription gog-gmail-watch-push-marcus \
  --bind 0.0.0.0 \
  --port 8790 \
  --path /gmail-pubsub-marcus \
  --tailscale off

sudo -n docker exec -d openclaw-gateway openclaw webhooks gmail run \
  --account marcuslrosser@gmail.com \
  --topic projects/vibecheck-ik969/topics/gog-gmail-watch-marcuslrosser \
  --subscription gog-gmail-watch-push-marcuslrosser \
  --bind 0.0.0.0 \
  --port 8791 \
  --path /gmail-pubsub-marcuslrosser \
  --tailscale off
