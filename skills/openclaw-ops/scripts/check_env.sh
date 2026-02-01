#!/usr/bin/env bash
set -euo pipefail

ROOT="${OPENCLAW_ROOT:-$HOME/ai-hell-mary}"
ENV_FILE="$ROOT/docker/.env"

echo "== Env file checks =="
if grep -q '^OPENAI_API_KEY=' "$ENV_FILE"; then
  echo "OPENAI_API_KEY present in .env"
else
  echo "OPENAI_API_KEY missing in .env"
fi

if grep -q '^GOOGLE_API_KEY=' "$ENV_FILE"; then
  echo "GOOGLE_API_KEY present in .env"
else
  echo "GOOGLE_API_KEY missing in .env"
fi

if grep -q '^OPENCLAW_SKIP_GMAIL_WATCHER=' "$ENV_FILE"; then
  echo "OPENCLAW_SKIP_GMAIL_WATCHER is set (built-in watcher disabled)"
else
  echo "OPENCLAW_SKIP_GMAIL_WATCHER not set (built-in watcher enabled)"
fi

echo
echo "== Container env presence (no secrets printed) =="
docker exec openclaw-gateway sh -lc 'test -n "$OPENAI_API_KEY" && echo OPENAI_API_KEY=SET || echo OPENAI_API_KEY=MISSING'
docker exec openclaw-gateway sh -lc 'test -n "$GOOGLE_API_KEY" && echo GOOGLE_API_KEY=SET || echo GOOGLE_API_KEY=MISSING'
