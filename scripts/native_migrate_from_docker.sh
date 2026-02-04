#!/usr/bin/env bash
set -euo pipefail

SRC_BASE=~/ai-hell-mary/data/openclaw
SRC_GOG=~/ai-hell-mary/data/gogcli
DEST_BASE=~/.openclaw
DEST_GOG=~/.config/gogcli

if [ ! -f "$SRC_BASE/openclaw.json" ]; then
  echo "Missing $SRC_BASE/openclaw.json. Copy your runtime config first."
  exit 1
fi

mkdir -p "$DEST_BASE" "$DEST_BASE/workspace" "$DEST_BASE/credentials" "$DEST_GOG"

cp -f "$SRC_BASE/openclaw.json" "$DEST_BASE/openclaw.json"
if [ -f "$SRC_BASE/exec-approvals.json" ]; then
  cp -f "$SRC_BASE/exec-approvals.json" "$DEST_BASE/exec-approvals.json"
fi

if [ -d "$SRC_BASE/workspace" ]; then
  cp -a "$SRC_BASE/workspace/." "$DEST_BASE/workspace/"
fi

if [ -d "$SRC_BASE/credentials" ]; then
  cp -a "$SRC_BASE/credentials/." "$DEST_BASE/credentials/"
fi

if [ -d "$SRC_GOG" ]; then
  cp -a "$SRC_GOG/." "$DEST_GOG/"
fi

chmod -R go-rwx "$DEST_BASE" || true
chmod -R go-rwx "$DEST_GOG" || true

# Rewrite googlechat serviceAccountFile path to the native credential location
python3 - <<'PY' || true
import json, os, pathlib
path = pathlib.Path(os.path.expanduser("~/.openclaw/openclaw.json"))
if not path.exists():
    raise SystemExit(0)
data = json.loads(path.read_text())
gc = data.get("channels", {}).get("googlechat")
if isinstance(gc, dict):
    sa = gc.get("serviceAccountFile")
    if sa and sa.startswith("/home/openclaw/"):
        native_sa = str(pathlib.Path(os.path.expanduser("~/.openclaw/credentials")) / pathlib.Path(sa).name)
        gc["serviceAccountFile"] = native_sa
        path.write_text(json.dumps(data, indent=2))
        print(f"Updated googlechat serviceAccountFile -> {native_sa}")
PY

echo "Migration complete: $DEST_BASE and $DEST_GOG"
