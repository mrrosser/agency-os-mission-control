#!/usr/bin/env bash
set -euo pipefail

INTERVAL="${AUTO_SYNC_INTERVAL:-300}"

if [[ "${AUTO_SYNC:-}" != "1" ]]; then
  echo "Set AUTO_SYNC=1 to enable auto sync."
  exit 1
fi

run_tests() {
  if [[ "${AUTO_SYNC_SKIP_TESTS:-}" == "1" ]]; then
    return 0
  fi
  echo "Running tests..."
  npm test
}

while true; do
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    echo "Auto sync paused (current branch: $branch)."
    sleep "$INTERVAL"
    continue
  fi

  if [[ -z "$(git status --porcelain)" ]]; then
    sleep "$INTERVAL"
    continue
  fi

  if ! run_tests; then
    echo "Tests failed; skipping push."
    sleep "$INTERVAL"
    continue
  fi

  git add -A
  msg="${AUTO_SYNC_MESSAGE:-chore: autosync $(date -Is)}"
  git commit -m "$msg" || { sleep "$INTERVAL"; continue; }
  git push
  sleep "$INTERVAL"
done
