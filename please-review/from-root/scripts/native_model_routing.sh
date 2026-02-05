#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}

python3 - <<'PY'
import json
import os
import urllib.request
from pathlib import Path

config_path = Path(os.environ.get("OPENCLAW_CONFIG", str(Path.home() / ".openclaw" / "openclaw.json")))
if not config_path.exists():
    raise SystemExit(f"Config not found: {config_path}")

data = json.loads(config_path.read_text())

def get_ids():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return set()
    req = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.load(resp)
    return {m.get("id") for m in payload.get("data", [])}

ids = get_ids()

def pick(candidates, default):
    for c in candidates:
        if c in ids:
            return c
    return default

brain_id = pick(["gpt-5.2", "gpt-5", "gpt-5.1"], "gpt-5")
codex_id = pick(["gpt-5-codex", "codex-mini-latest", "gpt-5.1-codex"], "gpt-5-codex")

agents = data.setdefault("agents", {})
defaults = agents.setdefault("defaults", {})
model = defaults.setdefault("model", {})
models = defaults.setdefault("models", {})

model["primary"] = f"openai/{brain_id}"

models.setdefault(f"openai/{brain_id}", {})["alias"] = "brain"
models.setdefault("openai/gpt-5-mini", {})["alias"] = "brain-fast"

models.setdefault(f"openai-codex/{codex_id}", {})["alias"] = "codex"
models.setdefault("openai-codex/codex-mini-latest", {})["alias"] = "codex-fast"

models.setdefault("google/gemini-2.5-pro", {})["alias"] = "gemini"
models.setdefault("google/gemini-2.5-flash", {})["alias"] = "gemini-fast"
models.setdefault("google/gemini-2.5-flash-lite", {})["alias"] = "gemini-lite"

config_path.write_text(json.dumps(data, indent=2))
print("Updated models in", config_path)
print("brain:", f"openai/{brain_id}")
print("codex:", f"openai-codex/{codex_id}")
PY
