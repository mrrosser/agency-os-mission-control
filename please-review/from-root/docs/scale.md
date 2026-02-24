# Scale Notes (A1 Maintenance)

This project uses a native OpenClaw Gateway on a GCE VM with Tailscale Serve
for private dashboard access and optional Tailscale Funnel webhook paths.

## A1 Maintenance Script

Location:
- `scripts/maintenance_restart.sh`

Purpose:
- Stops any leftover Docker gateway (avoids port conflicts)
- Restarts native `openclaw-gateway` and Gmail watcher services
- Reasserts Tailscale Serve for private dashboard access
- Repoints only enabled Funnel paths to localhost ports
- Prints quick status + lightweight HTTP checks

Run (WebSSH / VM shell):

```
sudo bash /home/marcu/ai-hell-mary/scripts/maintenance_restart.sh
```

Optional flags:
```
sudo ENABLE_GOOGLECHAT_FUNNEL=true ENABLE_GMAIL_PUBSUB_FUNNELS=false bash /home/marcu/ai-hell-mary/scripts/maintenance_restart.sh
```

Expected:
- `openclaw-gateway.service` shows **active (running)**
- Gmail watcher services show **active (running)**
- `googlechat` HTTP check returns **404/405** (OK). **502** means backend is down.
- `tailscale serve status` shows an HTTPS proxy to `127.0.0.1:18789`.

## Chat Webhook Quick Check

If the bot doesn't respond:
1) Check gateway log:
   ```
   sudo journalctl -u openclaw-gateway.service -n 200 --no-pager | grep -i googlechat
   ```
2) Check funnel routes:
   ```
   sudo tailscale serve status
   sudo tailscale funnel status
   ```

## Notes
- IAP SSH is for **admin**, not heavy traffic.
- Funnel paths should point to **127.0.0.1** native ports.
- Keep Funnel scope minimal (default is only `/googlechat`).
- Docker gateway must remain stopped during native mode.
- GitHub updates are applied by `openclaw-autosync.timer`. If it reports `dirty repo; skip auto-apply`, inspect changes as `marcu` (do not force reset blindly).
- Email triage runs on a schedule via `openclaw-email-triage.timer` and only creates drafts (never sends).
