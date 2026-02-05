#!/usr/bin/env bash
set -euo pipefail

CONTAINER_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' openclaw-gateway)

echo "Container IP: $CONTAINER_IP"

sudo tailscale funnel --bg --set-path /googlechat http://$CONTAINER_IP:18789
sudo tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://$CONTAINER_IP:8788
sudo tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://$CONTAINER_IP:8789
sudo tailscale funnel --bg --set-path /gmail-pubsub-marcus http://$CONTAINER_IP:8790
sudo tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://$CONTAINER_IP:8791

sudo tailscale funnel status
