#!/usr/bin/env bash
set -euo pipefail

CORRELATION_ID="${CORRELATION_ID:-oc-$(date +%Y%m%d%H%M%S)}"
log() {
  local msg="$1"
  printf '{"ts":"%s","level":"info","correlationId":"%s","msg":"%s"}\n' "$(date -Is)" "$CORRELATION_ID" "$msg"
}

log "Updating apt and installing prerequisites"
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release git

log "Installing Docker"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

log "Adding user to docker group"
sudo usermod -aG docker "$USER"

log "Docker install complete. Log out and back in for group changes to take effect."
