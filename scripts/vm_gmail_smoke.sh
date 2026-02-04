#!/usr/bin/env bash
set -euo pipefail

subs=$(gcloud pubsub subscriptions list --filter="name:gog-gmail-watch-push" --format="value(name)")
for s in $subs; do
  url=$(gcloud pubsub subscriptions describe "$s" --format="value(pushConfig.pushEndpoint)")
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  echo "$s -> HTTP $code"
done
