# Scale Notes (A1 Maintenance)

This project uses a native OpenClaw Gateway on a GCE VM with Tailscale Funnel
for Google Chat + Gmail Pub/Sub webhooks.

## A1 Maintenance Script

Location:
- `scripts/maintenance_restart.sh`

Purpose:
- Stops any leftover Docker gateway (avoids port conflicts)
- Restarts native `openclaw-gateway` and Gmail watcher services
- Repoints Tailscale Funnel to localhost ports
- Prints quick status + lightweight HTTP checks

Run (WebSSH / VM shell):

```
sudo bash /home/marcu/ai-hell-mary/scripts/maintenance_restart.sh
```

Expected:
- `openclaw-gateway.service` shows **active (running)**
- Gmail watcher services show **active (running)**
- `googlechat` + `mrosser` HTTP checks return **404/405** (OK). **502** means backend is down.

## Chat Webhook Quick Check

If the bot doesn't respond:
1) Check gateway log:
   ```
   sudo journalctl -u openclaw-gateway.service -n 200 --no-pager | grep -i googlechat
   ```
2) Check funnel routes:
   ```
   sudo tailscale funnel status || sudo tailscale serve status
   ```

## Notes
- IAP SSH is for **admin**, not heavy traffic.
- Funnel paths should point to **127.0.0.1** native ports.
- Docker gateway must remain stopped during native mode.
