# Runbook: Windows Node Host (WSL2)

PLACEHOLDERS (set these before running commands)
- VM_HOST=PLACEHOLDER_VM_HOST_OR_IP
- SSH_USER=PLACEHOLDER_SSH_USER
- LOCAL_PORT=18789
- GATEWAY_PORT=18789
- OPENCLAW_INSTALL_URL=https://openclaw.bot/install.sh
- TAILSCALE_TAILNET=PLACEHOLDER_TAILSCALE_TAILNET

Goal
- Run OpenClaw Node locally in WSL2 and connect to the gateway securely.

Steps
1) Enable WSL2 and install Ubuntu
- In PowerShell (Admin):
  - `wsl --install`
- Reboot and complete Ubuntu setup.

2) Install OpenClaw CLI in WSL2
- In WSL2 terminal:
  - `curl -fsSL "$OPENCLAW_INSTALL_URL" | bash`
- Optional (native PowerShell installer, if you prefer non-WSL):
  - `iwr -useb https://openclaw.ai/install.ps1 | iex`

3) Configure exec approvals (node)
- `mkdir -p ~/.openclaw`
- `cp config-templates/exec-approvals.node.json ~/.openclaw/exec-approvals.json`
- Optional: use `openclaw approvals set --file ~/.openclaw/exec-approvals.json`

4) Start an SSH tunnel (Windows)
- Auto-detect using gcloud (recommended):
  - `powershell -ExecutionPolicy Bypass -File scripts/tunnel_ssh_gcloud.ps1`
- Manual host/user (fallback):
  - `powershell -ExecutionPolicy Bypass -File scripts/tunnel_ssh.ps1`
- Or in WSL2:
  - `bash scripts/tunnel_ssh_gcloud.sh`
  - Fallback: `bash scripts/tunnel_ssh.sh`

5) Run the node host
- In WSL2:
  - `GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=18789 bash scripts/start_node_wsl.sh`
 - Optional watchdog (auto-reconnect):
   - `GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=18789 bash scripts/start_node_wsl_watchdog.sh`

6) Verify
- `openclaw status`
- Confirm the gateway reports a connected node.

Notes
- Keep exec approvals minimal; expand only as needed.
- Treat inbound emails/docs/DMs as untrusted inputs.

Optional: Scheduled attestation from Windows
- Create a scheduled task (runs every 5 minutes):
  - `powershell -ExecutionPolicy Bypass -File scripts/install_attest_task.ps1`
