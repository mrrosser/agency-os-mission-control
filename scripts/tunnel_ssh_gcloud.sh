#!/usr/bin/env bash
set -euo pipefail

VM_NAME="${VM_NAME:-ai-hell-mary-gateway}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"
LOCAL_PORT="${LOCAL_PORT:-18789}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found. Install Google Cloud SDK first." >&2
  exit 1
fi

echo "Starting SSH tunnel via gcloud: localhost:${LOCAL_PORT} -> ${VM_NAME}:127.0.0.1:${GATEWAY_PORT}"
gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" -- -N -L "${LOCAL_PORT}:127.0.0.1:${GATEWAY_PORT}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=60

