#!/usr/bin/env bash
set -euo pipefail

SEARCH="${SEARCH:-}" 
LIMIT="${LIMIT:-10}"

if [[ -z "$SEARCH" ]]; then
  echo "Usage: SEARCH=keyword bash scripts/mcp_registry_search.sh" >&2
  exit 1
fi

URL="https://registry.modelcontextprotocol.io/v0/servers?search=${SEARCH}&limit=${LIMIT}"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl not found." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found. Install jq." >&2
  exit 1
fi

curl -fsSL "$URL" | jq -r '.servers[] | "\(.name) | \(.description) | \(.repository)"'
