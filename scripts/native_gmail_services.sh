#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=${PROJECT_ID:-vibecheck-ik969}

sudo mkdir -p /etc/openclaw/gmail

sudo tee /etc/systemd/system/openclaw-gmail@.service > /dev/null <<'EOF'
[Unit]
Description=OpenClaw Gmail watcher (%i)
After=network-online.target openclaw-gateway.service
Wants=network-online.target

[Service]
Type=simple
User=marcu
WorkingDirectory=/home/marcu
EnvironmentFile=/etc/openclaw/openclaw.env
EnvironmentFile=/etc/openclaw/gmail/%i.env
Environment="PATH=/home/marcu/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/env openclaw webhooks gmail run \
  --account ${ACCOUNT} \
  --topic ${TOPIC} \
  --subscription ${SUBSCRIPTION} \
  --bind 127.0.0.1 \
  --port ${PORT} \
  --path ${WEBHOOK_PATH} \
  --tailscale off
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/openclaw/gmail/mrosser.env > /dev/null <<EOF
ACCOUNT=mrosser@rossernftgallery.com
TOPIC=projects/$PROJECT_ID/topics/gog-gmail-watch-mrosser
SUBSCRIPTION=gog-gmail-watch-push-mrosser
PORT=8788
WEBHOOK_PATH=/gmail-pubsub-mrosser
EOF

sudo tee /etc/openclaw/gmail/mcool4444.env > /dev/null <<EOF
ACCOUNT=mcool4444@gmail.com
TOPIC=projects/$PROJECT_ID/topics/gog-gmail-watch-mcool4444
SUBSCRIPTION=gog-gmail-watch-push-mcool4444
PORT=8789
WEBHOOK_PATH=/gmail-pubsub-mcool4444
EOF

sudo tee /etc/openclaw/gmail/marcus.env > /dev/null <<EOF
ACCOUNT=marcus@aicofoundry.com
TOPIC=projects/$PROJECT_ID/topics/gog-gmail-watch-marcus
SUBSCRIPTION=gog-gmail-watch-push-marcus
PORT=8790
WEBHOOK_PATH=/gmail-pubsub-marcus
EOF

sudo tee /etc/openclaw/gmail/marcuslrosser.env > /dev/null <<EOF
ACCOUNT=marcuslrosser@gmail.com
TOPIC=projects/$PROJECT_ID/topics/gog-gmail-watch-marcuslrosser
SUBSCRIPTION=gog-gmail-watch-push-marcuslrosser
PORT=8791
WEBHOOK_PATH=/gmail-pubsub-marcuslrosser
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-gmail@mrosser.service
sudo systemctl enable --now openclaw-gmail@mcool4444.service
sudo systemctl enable --now openclaw-gmail@marcus.service
sudo systemctl enable --now openclaw-gmail@marcuslrosser.service

sudo systemctl status openclaw-gmail@mrosser.service --no-pager
sudo systemctl status openclaw-gmail@mcool4444.service --no-pager
sudo systemctl status openclaw-gmail@marcus.service --no-pager
sudo systemctl status openclaw-gmail@marcuslrosser.service --no-pager
