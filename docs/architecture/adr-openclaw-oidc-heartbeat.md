# ADR: Google OIDC and Firestore for OpenClaw Runtime Heartbeats

Status: Accepted

Date: 2026-08-07

## Context

Agency OS runs in a Linux Cloud Run container, but its OpenClaw health check attempted to read `sync-manifest.json` from a Windows-local `AI_HELL_MARY_ROOT`. That path cannot exist in the deployed container, the local manifest was stale, and the VM had no corresponding manifest. The health signal must be non-model, low cost, authenticated, and useful even when model providers have no credit.

## Options considered

| Option | Benefits | Costs and risks |
| --- | --- | --- |
| Mount or copy the local manifest into Cloud Run | Reuses the current schema | Couples deployment to a workstation path and still does not prove the VM is alive |
| Static bearer webhook | Simple request validation | Adds a long-lived shared secret and rotation burden; a leaked token can be replayed indefinitely |
| Google OIDC receipt stored by the server in Firestore | Short-lived workload identity, no shared secret, server-authoritative receipt time, one durable control-plane source | Requires cross-project identity configuration and a small VM timer |

## Decision

Use a dedicated Agency OS POST route authenticated only with a Google-issued OIDC identity token. The route verifies the configured audience, Google issuer, verified email claim, and an explicit service-account email allowlist. It transactionally overwrites one `runtime_heartbeats/openclaw-gateway` document with `FieldValue.serverTimestamp()` as `receivedAt`.

The caller-provided `sent_at` is validated and retained for diagnostics, but it never determines health freshness. Replaying the same heartbeat ID is idempotent and does not update `receivedAt`. Older or duplicate sequences are rejected.

Agency OS derives the control-plane state from the server timestamp:

- `operational`: receipt is no more than 15 minutes old and all four critical units report active.
- `degraded`: receipt is stale or at least one critical unit is inactive, failed, or unknown.
- `offline`: no receipt exists, its server timestamp is invalid, or Firestore cannot be read.

The VM obtains a short-lived identity token from the GCE metadata server every five minutes. It refuses cross-origin endpoint/audience configuration and refuses redirects so the token cannot be forwarded to another origin.

## Trade-offs and consequences

- Firestore becomes the small durable dependency for this signal. Read failures intentionally report offline.
- A five-minute publisher interval and 15-minute stale threshold tolerate one transient failure without hiding sustained failure.
- Only the latest receipt is retained. This avoids unbounded storage; Cloud Logging and systemd journals provide history.
- The `runtime_heartbeats` collection has no client rule. The existing default-deny Firestore rule blocks all browser/client reads and writes; only Admin SDK code can access the receipt internals.
- Revisit a multi-runtime collection/index design only when more than one independently deployed OpenClaw runtime needs first-class status.
