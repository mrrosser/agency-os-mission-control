#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
Secrets Rotation Checklist
1) Enable stop switch and restart gateway.
2) Revoke OAuth tokens (Google) and create new client secrets.
3) Rotate GitHub fine-grained token.
4) Rotate Telegram bot token or Google Chat service account key.
5) Update env vars / secret manager references.
6) Run `openclaw security audit --deep`.
7) Disable stop switch after verification.
EOF
