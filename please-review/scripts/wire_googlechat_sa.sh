#!/usr/bin/env bash
set -euo pipefail

CORRELATION_ID="${CORRELATION_ID:-oc-$(date +%Y%m%d%H%M%S)}"
log() {
  local msg="$1"
  printf '{"ts":"%s","level":"info","correlationId":"%s","msg":"%s"}\n' "$(date -Is)" "$CORRELATION_ID" "$msg"
}

SRC_PATH="${SA_JSON_SRC:-}"
DEST_DIR="${DEST_DIR:-data/openclaw/credentials}"
DEST_NAME="${DEST_NAME:-openclaw-googlechat-sa.json}"
CONFIG_PATH="${CONFIG_PATH:-data/openclaw/openclaw.json}"
ENABLE_GOOGLECHAT="${ENABLE_GOOGLECHAT:-false}"

if [[ -z "$SRC_PATH" ]]; then
  echo "ERROR: SA_JSON_SRC is required (path to service account JSON on the VM)." >&2
  exit 1
fi

if [[ ! -f "$SRC_PATH" ]]; then
  echo "ERROR: Service account file not found: $SRC_PATH" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: OpenClaw config not found: $CONFIG_PATH" >&2
  exit 1
fi

log "Creating destination directory"
mkdir -p "$DEST_DIR"

DEST_PATH="$DEST_DIR/$DEST_NAME"
log "Copying service account JSON to $DEST_PATH"
cp "$SRC_PATH" "$DEST_PATH"
chmod 600 "$DEST_PATH"

SERVICE_ACCOUNT_PATH="/home/openclaw/.openclaw/credentials/$DEST_NAME"
log "Wiring service account path into config"
CONFIG_PATH="$CONFIG_PATH" SERVICE_ACCOUNT_PATH="$SERVICE_ACCOUNT_PATH" ENABLE_GOOGLECHAT="$ENABLE_GOOGLECHAT" python3 - <<'PY'
import json
import os

config_path = os.environ["CONFIG_PATH"]
sa_path = os.environ["SERVICE_ACCOUNT_PATH"]
enable = os.environ.get("ENABLE_GOOGLECHAT", "false").lower() in ("1", "true", "yes")

with open(config_path, "r", encoding="utf-8") as f:
    data = json.load(f)

channels = data.setdefault("channels", {})
gchat = channels.setdefault("googlechat", {})
gchat["serviceAccountFile"] = sa_path
if enable:
    gchat["enabled"] = True

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
PY

log "Done"
