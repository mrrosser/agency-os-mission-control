# Runbook: GCP Gateway (OpenClaw in Docker)

Note
- Docker is supported, but the native install is recommended for max stability.
- For native install, use: `docs/runbook-gcp-gateway-native.md`.

PLACEHOLDERS (set these before running commands)
- GCP_PROJECT_ID=ai-hell-mary
- GCP_REGION=us-central1
- GCP_ZONE=us-central1-a
- VM_NAME=ai-hell-mary-gateway
- VM_MACHINE_TYPE=e2-medium
- VM_BOOT_DISK_GB=30
- GCP_SA_NAME=openclaw-gateway
- GCP_SA_EMAIL=openclaw-gateway@ai-hell-mary.iam.gserviceaccount.com
- BILLING_ACCOUNT_ID=PLACEHOLDER_BILLING_ACCOUNT_ID
- OPENCLAW_INSTALL_URL=https://openclaw.bot/install.sh
- OPENCLAW_VERSION=latest
- OPENCLAW_IMAGE=PLACEHOLDER_OPENCLAW_IMAGE
- OPENCLAW_GATEWAY_TOKEN=PLACEHOLDER_GATEWAY_TOKEN
- TAILSCALE_AUTHKEY=PLACEHOLDER_TAILSCALE_AUTHKEY

Goal
- Provision a Debian GCE VM.
- Install Docker and run OpenClaw Gateway bound to loopback.
- Enable SSH tunnel or Tailscale access.

Prereqs
- `gcloud` installed locally and authenticated.
- GCP project + billing enabled.

Steps
1) Create service account and VM
- Use `infra/gcp/gcloud-commands.sh` for copy/paste commands.
- Keep firewall closed (no public port needed).
- Script will create the project if it doesn't exist; set `BILLING_ACCOUNT_ID` to link billing.
- Optional: run the interactive helper `bash scripts/pick_billing_account.sh`.

2) SSH into the VM
- `gcloud compute ssh ${VM_NAME} --zone ${GCP_ZONE}`

3) Install Docker on the VM
- From the VM:
  - `bash scripts/setup_gateway_vm.sh`

4) Prepare runtime data on the VM
- Clone this repo or copy the `docker/`, `config-templates/`, `openclaw-workspace-template/`, and `scripts/` folders.
- Create runtime directories:
  - `mkdir -p data/openclaw data/openclaw/workspace`
- Copy templates into runtime data (do not commit secrets):
  - `cp config-templates/openclaw.json.template data/openclaw/openclaw.json`
  - `cp config-templates/exec-approvals.gateway.json data/openclaw/exec-approvals.json`
  - `cp -R openclaw-workspace-template/* data/openclaw/workspace/`
- Edit `data/openclaw/openclaw.json` and set `gateway.auth.token` to a generated token.

5) Create env file for Docker Compose
- `cp docker/.env.template docker/.env`
- Edit `docker/.env` and set placeholders.
- Generate a gateway token and set `OPENCLAW_GATEWAY_TOKEN` (required).

6) Deploy the gateway
- `bash scripts/deploy_gateway_compose.sh`

7) Verify health
- `docker compose -f docker/docker-compose.yml --env-file docker/.env ps`
- `docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw health`
- `docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw security audit --deep`
- Optional remote attestation from your local machine:
  - `bash scripts/attest_gateway_gcloud.sh`
 - Optional scheduled attestation on the VM:
   - `bash scripts/install_attest_cron.sh`

8) Access pattern
- Preferred: SSH tunnel from your Windows machine (see `docs/runbook-windows-node.md`).
- Optional: Tailscale Serve for private UI; Funnel only for `/googlechat` webhook path if needed.

9) Stop switch (manual)
- Edit `data/openclaw/openclaw.json`:
  - Set `channels.googlechat.enabled` and `channels.telegram.enabled` to `false`.
  - Add `message`, `group:runtime`, and `group:fs` to `tools.deny`.
- Restart gateway: `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`

Notes
- Keep the gateway bound to `127.0.0.1`.
- Do not mount secrets in repo; use env vars or Secret Manager.



Docker Gmail smoke check (local, avoids IAP)
- `bash scripts/vm_gmail_smoke_local.sh`
