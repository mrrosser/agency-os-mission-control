#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <account_email> <port> [path]" >&2
  exit 1
fi

account="$1"
port="$2"
label="${account%%@*}"
path="${3:-/gmail-pubsub-${label}}"

docker exec -it openclaw-gateway openclaw webhooks gmail run \
  --account "$account" \
  --bind 127.0.0.1 \
  --port "$port" \
  --path "$path"
