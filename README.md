# AI Hell Mary - OpenClaw Hybrid Digital Employee (Gateway + Windows Node)

Revenue-first, secure-by-default deployment that keeps an always-on OpenClaw Gateway in GCP and connects your Windows machine as a Node host for hands-on work. Draft-first outbound, approvals for exec, least-privilege integrations, and a manual stop switch are baked in. Project codename: AI Hell Mary.

## First 60 Minutes Checklist
1. Provision Gateway VM (GCP).
2. Deploy OpenClaw Gateway (recommended: Native install; Docker also supported).
3. Connect one chat channel (Google Chat preferred; Telegram fallback).
4. Connect Windows Node host via SSH tunnel or Tailscale.
5. Run security audit and apply fixes.

## How to Run Locally (for testing)
- Copy templates into the runtime data directory:
  - `config-templates/openclaw.json.template` -> `data/openclaw/openclaw.json`
  - `config-templates/exec-approvals.gateway.json` -> `data/openclaw/exec-approvals.json`
  - `openclaw-workspace-template/` -> `data/openclaw/workspace/`
- Create env file: `copy docker/.env.template docker/.env` (Windows) or `cp docker/.env.template docker/.env` (Linux/WSL).
- Run: `docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build`

## How to Deploy (GCP VM + optional Cloud Run)
- GCP VM (native): follow `docs/runbook-gcp-gateway-native.md`.
- GCP VM (Docker): follow `docs/runbook-gcp-gateway.md`.
- Windows Node: follow `docs/runbook-windows-node.md`.
- Optional Cloud Run (read-first): `docs/runbook-gcp-cloudrun.md` shows how to set up discovery and approval-gated deploys.

## Docs
- `docs/overview.md`
- `docs/runbook-gcp-gateway-native.md`
- `docs/runbook-gcp-gateway.md`
- `docs/runbook-windows-node.md`
- `docs/runbook-channels-googlechat.md`
- `docs/runbook-channels-telegram.md`
- `docs/runbook-gmail-drive.md`
- `docs/runbook-playwright.md`
- `docs/runbook-web-browsing.md`
- `docs/runbook-skills.md`
- `docs/runbook-mcp-integrations.md`
- `docs/runbook-social-networks.md`
- `docs/runbook-twilio.md`
- `docs/runbook-elevenlabs.md`
- `docs/runbook-calendar.md`
- `docs/runbook-github-automation.md`
- `docs/runbook-context7.md`
- `docs/runbook-firestore.md`
- `docs/runbook-google-workspace.md`
- `docs/runbook-write-mode.md`
- `docs/runbook-github-prs.md`
- `docs/runbook-gcp-cloudrun.md`
- `docs/security-checklist.md`
- `docs/incident-response.md`
- `docs/execplans/openclaw-digital-employee.md`

## Observability
- JSON structured logs are expected for gateway and node; include a correlation ID on every tool call and outbound message.
- Logging is configured in `openclaw.json` under `logging` (JSON lines).

## Security Defaults
- Gateway bound to `127.0.0.1` and accessed via SSH tunnel or Tailscale.
- Exec approvals enforced with a minimal allowlist on gateway and node.
- Draft-first outbound messaging; explicit approval required.
- Stop switch: disable channels and add `message` + `group:runtime` + `group:fs` to `tools.deny`, then restart.

## Tests
- Unit: `python tests/openclaw_unit/test_config_templates.py`
- Smoke: `bash tests/openclaw_smoke/smoke_files.sh`


## GitHub Actions Watch
- `docs/runbook-github-actions-watch.md`
