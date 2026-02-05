#!/usr/bin/env bash
set -euo pipefail
cat >/etc/profile.d/openclaw_env.sh <<'EOF'
if [ -f /etc/openclaw/openclaw.env ]; then
  set -a
  . /etc/openclaw/openclaw.env
  set +a
fi
EOF
chmod 644 /etc/profile.d/openclaw_env.sh