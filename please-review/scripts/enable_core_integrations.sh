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

def is_placeholder(value: str) -> bool:
    return value.startswith("PLACEHOLDER")

path = os.environ["CONFIG_PATH"]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

updated = False

plugins = data.setdefault("plugins", {}).setdefault("entries", {})
voice_call = plugins.get("voice-call")
if isinstance(voice_call, dict):
    config = voice_call.get("config", {})
    twilio = config.get("twilio", {})
    acct = str(twilio.get("accountSid", ""))
    token = str(twilio.get("authToken", ""))
    if acct and token and not is_placeholder(acct) and not is_placeholder(token):
        voice_call["enabled"] = True
        updated = True
    else:
        print("Twilio placeholders detected; leaving voice-call plugin disabled.")

messages = data.setdefault("messages", {}).setdefault("tts", {})
voice_id = str(messages.get("elevenlabs", {}).get("voiceId", ""))
if voice_id and not is_placeholder(voice_id):
    messages.setdefault("auto", "tagged")
    updated = True
else:
    print("ElevenLabs placeholders detected; leaving TTS settings as-is.")

if updated:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print("Core integrations enabled where placeholders were replaced.")
else:
    print("No changes made.")
PY
