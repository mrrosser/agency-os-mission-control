---
name: openclaw-ops
description: Operate and troubleshoot the OpenClaw gateway in GCP (Docker lifecycle, env/config wiring, logs/health checks, rebuilds, and channel readiness). Use for recurring ops tasks, "container hangs," missing env vars, plugin load errors, or when preparing the gateway for OAuth/webhook setup.
---

# Openclaw Ops

## Overview

Use this skill to keep the gateway stable and fast: persistent SSH, health checks, rebuilds/recreates, and safe env/config updates without leaking secrets.

## Quick Start (Most common fixes)

1) Open a persistent SSH session and attach tmux:

```bash
gcloud compute ssh ai-hell-mary-gateway --zone us-central1-a --project vibecheck-ik969
tmux new -s openclaw
```

2) Run a fast health check:

```bash
scripts/gateway_health.sh
```

3) Recreate the gateway container after env/config updates:

```bash
scripts/gateway_recreate.sh
```

4) If you changed the Dockerfile or plugins, rebuild then recreate:

```bash
scripts/gateway_rebuild.sh
```

## Workflow: Diagnose -> Fix -> Verify

1) **Diagnose**
   - `scripts/gateway_health.sh`
   - Check gateway logs, OpenClaw status, and plugin load errors.
2) **Fix**
   - **Missing env var**: update `~/ai-hell-mary/docker/.env`, then recreate.
   - **Plugin errors**: rebuild image to include missing deps.
3) **Verify**
   - `openclaw status` and a channel message test.

## Common Issues (See references)

- **Bracketed paste** breaks commands in SSH
- **Missing env vars** cause config load errors
- **Plugin deps missing** after upgrades
- **Long builds** due to Docker cache or insufficient disk

See `references/common-errors.md`.

## Resources (optional)

### scripts/

- `scripts/gateway_health.sh`: Fast health and log checks
- `scripts/gateway_recreate.sh`: Reload container with new env/config
- `scripts/gateway_rebuild.sh`: Rebuild image and reload
- `scripts/check_env.sh`: Confirm required env vars and config paths

### references/
- `references/common-errors.md`
- `references/paths.md`
