#!/usr/bin/env bash
set -euo pipefail

SRC="config-templates/openclaw.json.template"
DEST="config-templates/openclaw.json.write.template"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: Missing $SRC" >&2
  exit 1
fi

python3 - <<'PY'
import json

src = "config-templates/openclaw.json.template"
dest = "config-templates/openclaw.json.write.template"

with open(src, "r", encoding="utf-8") as f:
    data = json.load(f)

tools = data.setdefault("tools", {})
tools["deny"] = []
web = tools.setdefault("web", {})
search = web.setdefault("search", {})
search["enabled"] = True

with open(dest, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print(f"Wrote {dest}")
PY
