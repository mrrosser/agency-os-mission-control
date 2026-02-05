# Runbook: GCP Gateway (OpenClaw native)

PLACEHOLDERS (set these before running commands)
- GCP_PROJECT_ID=vibecheck-ik969
- GCP_ZONE=us-central1-a
- VM_NAME=ai-hell-mary-gateway
- OPENCLAW_PORT=18789
- OPENCLAW_GATEWAY_TOKEN=PLACEHOLDER_GATEWAY_TOKEN
- OPENAI_API_KEY=PLACEHOLDER_OPENAI_API_KEY
- GEMINI_API_KEY=PLACEHOLDER_GEMINI_API_KEY
- GOG_KEYRING_PASSWORD=PLACEHOLDER_GOG_KEYRING_PASSWORD

Goal
- Run OpenClaw directly on the VM (native install) for max stability.
- Use Tailscale Funnel for Google Chat + Gmail Pub/Sub webhooks.
- Keep IAP SSH for light admin access only.

Prereqs
- SSH access to the VM.
- Tailscale installed and authenticated on the VM.
- OAuth tokens for Gmail already created (gogcli tokens).

Steps
1) Install OpenClaw (native)
- On the VM (as user `marcu`):
  - `bash scripts/native_install.sh`
  - `openclaw onboard --install-daemon`

2) Migrate config + credentials from Docker (if previously used)
- On the VM:
  - `bash scripts/native_migrate_from_docker.sh`

3) Create env file for OpenClaw
- Create `/etc/openclaw/openclaw.env` on the VM:
  - `sudo mkdir -p /etc/openclaw`
  - `sudo nano /etc/openclaw/openclaw.env`
- Add (one per line):
  - `OPENCLAW_GATEWAY_TOKEN=...`
  - `OPENAI_API_KEY=...`
  - `GEMINI_API_KEY=...`
  - `GOG_KEYRING_PASSWORD=...`

4) Install/enable the native gateway service
- On the VM:
  - `bash scripts/native_gateway_service.sh`


4b) Apply model routing (brain/codex/gemini)
- On the VM:
  - `bash scripts/native_model_routing.sh`

5) Configure Gmail webhook runners (systemd)
- On the VM:
  - `bash scripts/native_gmail_services.sh`

6) Repoint Tailscale Funnel paths (native)
- On the VM:
  - `bash scripts/native_tailscale_repoint.sh`

7) Verify locally (avoid heavy IAP smoke tests)
- On the VM:
  - `bash scripts/native_gmail_smoke_local.sh`

Notes
- Gmail Pub/Sub expects HTTP 200/404 on GET; actual pushes are POST.
- If IAP is unstable, do local checks and only use IAP for short admin sessions.
- Keep the gateway bound to loopback and expose only the webhook paths via Funnel.
