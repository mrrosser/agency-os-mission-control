#!/usr/bin/env bash
set -euo pipefail

VM_HOST="${VM_HOST:-PLACEHOLDER_VM_HOST_OR_IP}"
SSH_USER="${SSH_USER:-PLACEHOLDER_SSH_USER}"
LOCAL_PORT="${LOCAL_PORT:-18789}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

if [[ "$VM_HOST" == PLACEHOLDER_* || "$SSH_USER" == PLACEHOLDER_* ]]; then
  echo "Set VM_HOST and SSH_USER before running." >&2
  exit 1
fi

echo "Starting SSH tunnel: localhost:${LOCAL_PORT} -> ${VM_HOST}:127.0.0.1:${GATEWAY_PORT}"
ssh -N -L "${LOCAL_PORT}:127.0.0.1:${GATEWAY_PORT}" "${SSH_USER}@${VM_HOST}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=60
