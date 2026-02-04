#!/usr/bin/env bash
set -euo pipefail
apt-get update
apt-get install -y unzip
mkdir -p /home/marcu/ai-hell-mary/scripts
unzip -o /tmp/native-scripts.zip -d /home/marcu/ai-hell-mary
chown -R marcu:marcu /home/marcu/ai-hell-mary/scripts
chmod +x /home/marcu/ai-hell-mary/scripts/native_*.sh
ls -l /home/marcu/ai-hell-mary/scripts/native_*.sh
