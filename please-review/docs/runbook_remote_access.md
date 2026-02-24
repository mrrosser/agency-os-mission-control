# Runbook: Remote Access (Tailscale Serve)

Goal
- Replace operator SSH `-L` tunnels with Tailscale Serve for stable tailnet-only access to OpenClaw Control UI.
- Keep the gateway bound to loopback (`127.0.0.1`) and never expose port `18789` publicly.
- Optionally expose only `/googlechat` using Tailscale Funnel when Google Chat webhooks are hosted on this VM.

Security model
- OpenClaw Gateway listens on localhost only (Docker port map `127.0.0.1:18789:18789`).
- Tailscale Serve publishes dashboard access only to authenticated tailnet devices.
- Tailscale Funnel is optional and should expose only the webhook path, never `/`.

## 1) Host-level Tailscale install + auth (VM)

Install (Debian/Ubuntu VM):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
```

Authenticate (one-time):
```bash
sudo tailscale up
```

Verify:
```bash
tailscale status
tailscale ip
```

## 2) Ensure OpenClaw is localhost-only

Compose mapping must remain loopback-only:
```yaml
ports:
  - "127.0.0.1:18789:18789"
```

VM-side smoke check:
```bash
curl -I http://127.0.0.1:18789
```

## 3) Configure private dashboard via Serve

Run:
```bash
bash scripts/tailscale_serve_setup.sh
```

Script behavior:
- validates `tailscale`, `tailscaled`, and auth state,
- verifies local gateway health (`http://127.0.0.1:18789`),
- applies idempotent Serve config:
  - `tailscale serve --bg --https 8443 http://127.0.0.1:18789`
- prints status + final URL.

Direct command equivalent:
```bash
sudo tailscale serve --bg --https 8443 http://127.0.0.1:18789
```

Verify:
```bash
tailscale serve status
docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw gateway status
```

Access URL (from any tailnet-authenticated device):
```text
https://<node-name>.<tailnet>.ts.net:8443/
```

Rollback:
```bash
sudo tailscale serve reset
```

## 4) Optional Google Chat public webhook only

If this VM hosts Google Chat webhook ingress:
```bash
bash scripts/tailscale_funnel_googlechat.sh
```

Direct command equivalent:
```bash
sudo tailscale funnel --bg --set-path /googlechat http://127.0.0.1:18789/googlechat
```

This exposes only:
```text
/googlechat -> http://127.0.0.1:18789/googlechat
```

Verify:
```bash
tailscale funnel status
```

Rollback:
```bash
sudo tailscale funnel reset
```

Note
- Use the public Funnel URL + `/googlechat` in Google Chat app webhook settings (no `:8443`).
- Keep dashboard/private routes on Serve only.

## 5) Boot-time reassert (belt-and-suspenders)

Install unit:
```bash
sudo cp ops/openclaw-tailscale-serve.service /etc/systemd/system/openclaw-tailscale-serve.service
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-tailscale-serve.service
sudo systemctl status --no-pager openclaw-tailscale-serve.service
```

What it does:
- runs `scripts/tailscale_serve_setup.sh` at boot (after network/docker),
- reasserts Serve config even if control-plane state changed.

## 6) Tailscale SSH admin access (replace day-to-day Web SSH)

Run once:
```bash
bash scripts/tailscale_admin_setup.sh
```

Install boot-time reassert:
```bash
sudo cp ops/openclaw-tailscale-admin.service /etc/systemd/system/openclaw-tailscale-admin.service
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-tailscale-admin.service
sudo systemctl status --no-pager openclaw-tailscale-admin.service
```

Verify:
```bash
tailscale status --json | jq '.Self.DNSName, .Self.SSHEnabled'
```

Connect from any tailnet device:
```bash
ssh marcu@<node-name>.<tailnet>.ts.net
```

Rollback:
```bash
sudo tailscale set --ssh=false
sudo systemctl disable --now openclaw-tailscale-admin.service
```

## 7) Scheduled health checks + weekly auto-update

Install units:
```bash
sudo cp ops/openclaw-healthcheck.service /etc/systemd/system/openclaw-healthcheck.service
sudo cp ops/openclaw-healthcheck.timer /etc/systemd/system/openclaw-healthcheck.timer
sudo cp ops/openclaw-weekly-update.service /etc/systemd/system/openclaw-weekly-update.service
sudo cp ops/openclaw-weekly-update.timer /etc/systemd/system/openclaw-weekly-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-healthcheck.timer openclaw-weekly-update.timer
```

Verify:
```bash
systemctl list-timers --all | grep -E "openclaw-healthcheck|openclaw-weekly-update"
journalctl -u openclaw-healthcheck.service -n 100 --no-pager
journalctl -u openclaw-weekly-update.service -n 100 --no-pager
```

Notes:
- `openclaw-healthcheck.timer` runs every 15 minutes (health only).
- `openclaw-weekly-update.timer` runs Sundays around 04:30 (pull + restart + health).
- Both timers call `scripts/openclaw_ops_cycle.sh` with structured logs and lock protection.

Rollback:
```bash
sudo systemctl disable --now openclaw-healthcheck.timer openclaw-weekly-update.timer
```

## 8) Update + GChat quick diagnostics

Check update complete:
```bash
docker exec -i openclaw-gateway openclaw --version
docker ps --format '{{.Names}} {{.Status}}'
```

Check GChat responsiveness:
```bash
docker logs --tail 200 openclaw-gateway | grep -Ei "googlechat|chat|webhook|error"
tailscale funnel status
curl -i http://127.0.0.1:18789/googlechat
```

Interpretation:
- `404` or `405` on webhook probe can be normal for GET probes.
- repeated `401/403/5xx` in logs means webhook auth/routing issue.
- no inbound webhook logs means Google Chat app URL/path mismatch.
