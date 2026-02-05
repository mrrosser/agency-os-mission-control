#!/usr/bin/env bash
set -euo pipefail
ENV=/etc/openclaw/openclaw.env
umask 077
touch "$ENV"
if ! grep -q "^OPENCLAW_GATEWAY_TOKEN=" "$ENV"; then
  TOKEN=$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)
  echo "OPENCLAW_GATEWAY_TOKEN=$TOKEN" >> "$ENV"
fi
chmod 600 "$ENV"