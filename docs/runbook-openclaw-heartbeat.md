# OpenClaw Runtime Heartbeat Runbook

## Purpose

The OpenClaw gateway VM publishes a non-model health receipt every five minutes. Agency OS authenticates the VM with Google OIDC, stores one server-timestamped Firestore document, and presents the receipt as `openclaw_sync` in Agent Nexus. The same receipt may include optional `paperclip_api` and `paperclip_bridge` states so the private loopback-only Paperclip runtime can be visible without exposing its URL or credentials.

## Agency OS configuration

Resolve the canonical Cloud Run origin and configure the exact publisher identity:

```bash
AGENCY_ORIGIN="$(gcloud run services describe ssrleadflowreview --project=leadflow-review --region=us-central1 --format='value(status.url)')"
PUBLISHER_SA="openclaw-gateway@vibecheck-ik969.iam.gserviceaccount.com"
gcloud run services update ssrleadflowreview \
  --project=leadflow-review \
  --region=us-central1 \
  --update-env-vars="OPENCLAW_HEARTBEAT_OIDC_AUDIENCES=${AGENCY_ORIGIN},OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS=${PUBLISHER_SA},OPENCLAW_HEARTBEAT_RUNTIME_ID=openclaw-gateway"
```

If Cloud Run invocation is restricted, grant only the VM service account permission to invoke the service:

```bash
gcloud run services add-iam-policy-binding ssrleadflowreview \
  --project=leadflow-review \
  --region=us-central1 \
  --member="serviceAccount:${PUBLISHER_SA}" \
  --role=roles/run.invoker
```

The route does not accept a static bearer fallback. Missing OIDC configuration returns 503; missing or invalid identity returns 401/403.

## Firestore contract

- Collection/document: `runtime_heartbeats/openclaw-gateway`
- Write path: Firebase Admin SDK only
- Client access: denied by the default `match /{document=**}` rule
- Authoritative freshness: `receivedAt`, set with `FieldValue.serverTimestamp()`
- Default stale threshold: 900 seconds (`OPENCLAW_HEARTBEAT_STALE_AFTER_SECONDS`)
- Retention: one overwritten document; no unbounded event collection

## VM configuration

Create `/etc/openclaw/openclaw-heartbeat.env` as a root-owned mode-0600 file containing only non-secret routing values:

```dotenv
OPENCLAW_HEARTBEAT_URL=https://SERVICE_URL/api/agents/openclaw-heartbeat
OPENCLAW_HEARTBEAT_AUDIENCE=https://SERVICE_URL
OPENCLAW_HEARTBEAT_RUNTIME_ID=openclaw-gateway
OPENCLAW_HEARTBEAT_TIMEOUT_MS=20000
```

Then install and test the timer from the merged AI_HELL_MARY checkout:

```bash
sudo OPENCLAW_USER=marcu REPO_DIR=/home/marcu/ai-hell-mary \
  bash scripts/native_openclaw_heartbeat_service.sh
sudo systemctl start openclaw-runtime-heartbeat.service
systemctl is-enabled openclaw-runtime-heartbeat.timer
systemctl is-active openclaw-runtime-heartbeat.timer
journalctl -u openclaw-runtime-heartbeat.service -n 50 --no-pager
```

Never copy the metadata identity token into a file, environment variable, command history, or log. The publisher obtains a new token in memory for each request and refuses redirects.

## Expected status

- `operational`: server receipt is fresh and every reported critical unit is active. Legacy publishers may report only the gateway and three voice MCP units; newer publishers also report Paperclip API and bridge freshness.
- `degraded`: receipt is older than the threshold or a critical unit is not active.
- `offline`: receipt is missing/invalid or Firestore cannot be read.

When both optional Paperclip states are present and active, the Paperclip System card uses an authenticated `visibility_only` projection. This projection never enables lifecycle actions and does not claim company, agent, or active-run counts. A missing/stale bridge or unhealthy API degrades Paperclip status. A legacy heartbeat with neither optional field remains valid and does not fabricate Paperclip availability.

## Diagnostics

```bash
systemctl status openclaw-runtime-heartbeat.timer --no-pager
systemctl status openclaw-runtime-heartbeat.service --no-pager
journalctl -u openclaw-runtime-heartbeat.service --since '-20 minutes' --no-pager
```

Check Cloud Run logs for `agents.openclaw_heartbeat.receipt_recorded` using the same correlation ID. An unauthenticated POST should fail and must never create or refresh the Firestore receipt.

## Rollback

```bash
sudo systemctl disable --now openclaw-runtime-heartbeat.timer
```

Then revert the two implementation PRs. The existing Firestore document is inert and remains client-inaccessible; it may be deleted later through a controlled Admin SDK operation.
