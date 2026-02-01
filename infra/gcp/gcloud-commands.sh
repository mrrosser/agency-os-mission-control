#!/usr/bin/env bash
set -euo pipefail

CORRELATION_ID="${CORRELATION_ID:-oc-$(date +%Y%m%d%H%M%S)}"
log() {
  local msg="$1"
  printf '{"ts":"%s","level":"info","correlationId":"%s","msg":"%s"}\n' "$(date -Is)" "$CORRELATION_ID" "$msg"
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ "$value" == PLACEHOLDER_* || -z "$value" ]]; then
    echo "ERROR: $name is not set or still a placeholder." >&2
    exit 1
  fi
}

: "${GCP_PROJECT_ID:=ai-hell-mary}"
: "${GCP_REGION:=us-central1}"
: "${GCP_ZONE:=us-central1-a}"
: "${VM_NAME:=ai-hell-mary-gateway}"
: "${VM_MACHINE_TYPE:=e2-medium}"
: "${VM_BOOT_DISK_GB:=30}"
: "${GCP_SA_NAME:=openclaw-gateway}"
: "${BILLING_ACCOUNT_ID:=PLACEHOLDER_BILLING_ACCOUNT_ID}"

require_value GCP_PROJECT_ID "$GCP_PROJECT_ID"
require_value GCP_REGION "$GCP_REGION"
require_value GCP_ZONE "$GCP_ZONE"
require_value VM_NAME "$VM_NAME"
require_value VM_MACHINE_TYPE "$VM_MACHINE_TYPE"
require_value VM_BOOT_DISK_GB "$VM_BOOT_DISK_GB"
require_value GCP_SA_NAME "$GCP_SA_NAME"

log "Ensuring project exists"
if ! gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  gcloud projects create "$GCP_PROJECT_ID" --name="AI Hell Mary"
  if [[ "$BILLING_ACCOUNT_ID" != PLACEHOLDER_* && -n "$BILLING_ACCOUNT_ID" ]]; then
    gcloud billing projects link "$GCP_PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
  else
    echo "WARNING: BILLING_ACCOUNT_ID not set; link billing to proceed." >&2
  fi
fi

log "Setting gcloud project"
gcloud config set project "$GCP_PROJECT_ID"

log "Creating service account"
gcloud iam service-accounts create "$GCP_SA_NAME" \
  --display-name="OpenClaw Gateway" || true

GCP_SA_EMAIL="${GCP_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

log "Binding minimal roles to service account"
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${GCP_SA_EMAIL}" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${GCP_SA_EMAIL}" \
  --role="roles/monitoring.metricWriter"

gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${GCP_SA_EMAIL}" \
  --role="roles/run.viewer"

log "Creating VM (no public service port exposed)"
if gcloud compute instances describe "$VM_NAME" --zone="$GCP_ZONE" >/dev/null 2>&1; then
  log "VM already exists, skipping create"
else
  gcloud compute instances create "$VM_NAME" \
    --zone="$GCP_ZONE" \
    --machine-type="$VM_MACHINE_TYPE" \
    --boot-disk-size="$VM_BOOT_DISK_GB" \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --service-account="$GCP_SA_EMAIL" \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --tags="openclaw-gateway"
fi

log "Done"

