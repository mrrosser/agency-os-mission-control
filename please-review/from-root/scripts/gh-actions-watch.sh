#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-mrrosser/AI-Hell-Mary}"
INTERVAL="${2:-30}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed or not in PATH." >&2
  exit 1
fi

while true; do
  run_json="$(gh run list -R "$REPO" --limit 1 --json databaseId,displayTitle,status,conclusion,updatedAt)"
  if [[ -z "$run_json" || "$run_json" == "[]" ]]; then
    echo "No runs found for $REPO"
    sleep "$INTERVAL"
    continue
  fi
  run_id="$(echo "$run_json" | python - <<'PY'
import json,sys
runs=json.load(sys.stdin)
print(runs[0]['databaseId'])
PY
)"
  status="$(echo "$run_json" | python - <<'PY'
import json,sys
runs=json.load(sys.stdin)
print(runs[0]['status'])
PY
)"
  conclusion="$(echo "$run_json" | python - <<'PY'
import json,sys
runs=json.load(sys.stdin)
c=runs[0]['conclusion']
print(c if c else 'pending')
PY
)"
  title="$(echo "$run_json" | python - <<'PY'
import json,sys
runs=json.load(sys.stdin)
print(runs[0]['displayTitle'])
PY
)"

  echo "[$run_id] $status $conclusion - $title"

  if [[ "$conclusion" != "pending" ]]; then
    exit 0
  fi
  sleep "$INTERVAL"
done
