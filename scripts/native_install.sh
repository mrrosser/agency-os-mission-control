#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_INSTALL_URL=${OPENCLAW_INSTALL_URL:-https://openclaw.bot/install.sh}

sudo apt-get update
sudo apt-get install -y curl jq ca-certificates gnupg lsb-release

if ! command -v openclaw >/dev/null 2>&1; then
  curl -fsSL "$OPENCLAW_INSTALL_URL" | bash
fi

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

mkdir -p ~/.openclaw ~/.config/gogcli
