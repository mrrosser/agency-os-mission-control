#!/usr/bin/env bash
set -euo pipefail

VM_NAME="${VM_NAME:-ai-hell-mary-gateway}"
GCP_ZONE="${GCP_ZONE:-us-central1-a}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found. Install Google Cloud SDK first." >&2
  exit 1
fi

echo "Running gateway health check via gcloud on ${VM_NAME} (${GCP_ZONE})"

gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command \
  "docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw health"

gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command \
  "docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw status"

# If you want to verify the security audit quickly (no fixes):
# gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command \
#   "docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw security audit --deep"

