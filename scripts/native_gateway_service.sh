#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /etc/openclaw

sudo tee /etc/systemd/system/openclaw-gateway.service > /dev/null <<'EOF'
[Unit]
Description=OpenClaw Gateway (native)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=marcu
WorkingDirectory=/home/marcu
EnvironmentFile=/etc/openclaw/openclaw.env
Environment="PATH=/home/marcu/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=/home/marcu"
Environment="OPENCLAW_HOME=/home/marcu/.openclaw"
ExecStart=/usr/bin/env openclaw gateway --port 18789 --verbose
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-gateway.service
sudo systemctl status openclaw-gateway.service --no-pager
