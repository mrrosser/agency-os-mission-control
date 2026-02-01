#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${CONFIG_PATH:-data/openclaw/openclaw.json}"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "ERROR: Config not found: $CONFIG_PATH" >&2
  exit 1
fi

python3 - <<'PY'
import json
import os

path = os.environ["CONFIG_PATH"]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

tools = data.setdefault("tools", {})
tools["deny"] = []

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print("Write mode enabled (tools.deny cleared).")
PY
