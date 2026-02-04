#!/usr/bin/env bash
set -euo pipefail

HOST=127.0.0.1

# Keep /googlechat routed to the webhook path (avoid stripping to /)
sudo tailscale funnel --bg --set-path /googlechat http://$HOST:18789/googlechat
sudo tailscale funnel --bg --set-path /gmail-pubsub-mrosser http://$HOST:8788
sudo tailscale funnel --bg --set-path /gmail-pubsub-mcool4444 http://$HOST:8789
sudo tailscale funnel --bg --set-path /gmail-pubsub-marcus http://$HOST:8790
sudo tailscale funnel --bg --set-path /gmail-pubsub-marcuslrosser http://$HOST:8791

sudo tailscale funnel status
