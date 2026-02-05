#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "Usage: $0 <account_email> <gcp_project_id> <topic> <subscription> <port> [path] [tailscale_path]" >&2
  exit 1
fi

account="$1"
project="$2"
topic="$3"
subscription="$4"
port="$5"
label="${account%%@*}"
path="${6:-/gmail-pubsub-${label}}"
tailscale_path="${7:-${path}}"

docker exec -it openclaw-gateway openclaw webhooks gmail setup \
  --account "$account" \
  --project "$project" \
  --topic "$topic" \
  --subscription "$subscription" \
  --bind 127.0.0.1 \
  --port "$port" \
  --path "$path" \
  --tailscale-path "$tailscale_path"
