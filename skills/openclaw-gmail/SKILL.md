---
name: openclaw-gmail
description: Configure OpenClaw Gmail Pub/Sub webhooks with gog + gcloud, manage multi-account OAuth, and verify watchers. Use when setting up Gmail/Drive/Calendar access, adding accounts, or troubleshooting Gmail hook errors.
---

# Openclaw Gmail

## Overview

This skill standardizes Gmail webhook setup so multi-account OAuth and Pub/Sub are consistent, repeatable, and safe.

## Quick Start (single account)

1) Verify prerequisites in the container:

```bash
docker exec openclaw-gateway gcloud --version
docker exec openclaw-gateway gog --version
```

2) Authenticate gog (browser login required):

```bash
docker exec -it openclaw-gateway gog auth login
```

3) Run setup:

```bash
docker exec -it openclaw-gateway openclaw webhooks gmail setup \
  --account you@example.com \
  --project vibecheck-ik969 \
  --topic gog-gmail-watch-you \
  --subscription gog-gmail-watch-push-you \
  --bind 127.0.0.1 \
  --port 8788 \
  --path /gmail-pubsub-you \
  --tailscale-path /gmail-pubsub-you
```

## Workflow (multi-account)

1) **Pick unique values** per account:
   - Topic, subscription, port, and path must be unique.
2) **Run `gog auth login`** for the correct account.
3) **Run setup** with unique values for each account.
4) **Verify** using `openclaw webhooks gmail run` or test emails.

## Auto-watcher vs systemd

- **Built-in auto watcher**: make sure `OPENCLAW_SKIP_GMAIL_WATCHER` is NOT set.
- **Systemd watchers**: only use if you want system-level control.

## Troubleshooting

See `references/troubleshooting.md` for:
- `gog not installed`
- `gcloud not installed`
- `MissingEnvVar OPENAI_API_KEY`
- Pub/Sub push endpoint issues

## Resources (optional)

### scripts/
- `scripts/gmail_setup.sh`: Standardized setup with placeholders
- `scripts/gmail_run.sh`: Run watcher on demand
- `scripts/gmail_verify.sh`: Quick checks for gcloud/gog/env

### references/
- `references/gmail-accounts.md`
- `references/troubleshooting.md`
