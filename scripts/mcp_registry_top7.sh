#!/usr/bin/env bash
set -euo pipefail

# Suggest 7 MCP servers by querying the registry with common categories.
# Adjust SEARCH terms as needed.

SEARCH_TERMS=("calendar" "gmail" "github" "twilio" "elevenlabs" "playwright" "browser")

for term in "${SEARCH_TERMS[@]}"; do
  echo "== ${term} =="
  SEARCH="$term" LIMIT=3 bash scripts/mcp_registry_search.sh || true
  echo ""
done
