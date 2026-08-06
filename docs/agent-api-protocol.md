# Mission Control Agent API Protocol

## Policy

`lib/agents/registry.ts` is the single source of truth for agent IDs, aliases, allowed business units, Google Chat spaces, scopes, trust levels, capabilities, service dependencies, and cost metadata.

The five bounded revenue specialists are:

- `opportunity-scout`
- `qualification-verifier`
- `application-drafter`
- `meeting-outreach-prep`
- `crm-reconciler`

They may search, score, prepare, draft, and reconcile internal CRM state. They cannot declare email send, calendar create, SMS, voice, public publish, or payment capabilities. Those consequential external-write capabilities belong only to the existing `fn-actions` executor and remain subject to Mission Control approval and kill-switch policy.

## Heartbeat contract

`POST /api/agents/status` requires a Firebase bearer token and the v1 trust envelope documented in `public/openapi.yaml`:

```json
{
  "agent_id": "opportunity-scout",
  "org_id": "ORG_FROM_AUTHENTICATED_CONTEXT",
  "business_id": "rt_solutions",
  "space_id": "spaces/AAQA84U_woE",
  "scope": ["opportunities"],
  "trust_level": "read_only",
  "evidence_ref": "drive:source-document-id",
  "run_id": "opportunity-run-20260806",
  "correlation_id": "trace-20260806-001",
  "idempotency_key": "heartbeat:opportunity-run-20260806:001",
  "policy_version": "mission-control-agent/v1",
  "timestamp": "2026-08-06T16:00:00.000Z",
  "capabilities": ["research.search", "opportunity.discover"],
  "state": "active"
}
```

The route rejects unknown IDs, unregistered spaces, stale/future timestamps, cross-org writes, caller-disallowed business units, and capabilities that are not declared for the agent. Retries with the same idempotency key replay the prior response.

`GET /api/agents/status` returns caller-scoped heartbeat state plus the capability descriptors the caller may use. Legacy stored rows without a complete v1 envelope are intentionally filtered until the corresponding agent sends a fresh heartbeat.

## Registered spaces

The current exact bindings are intentionally fail closed:

| Key | Space ID |
| --- | --- |
| Outreach | `spaces/AAQA62xqRGQ` |
| Coding / Infrastructure | `spaces/AAQALocqO7Q` |
| Marketing / Social | `spaces/AAQAcKXw-dU` |
| Research Intelligence | `spaces/AAQA84U_woE` |
| Mission Control Operations | `spaces/AAQAJt-QD1I` |

Add a new binding in the canonical registry and its tests before a runtime may send heartbeats from it.

## Connector health

`GET /api/agents/control-plane` probes configured SMAuto and LeadOps MCP endpoints with a bounded protocol handshake:

1. `initialize`
2. `notifications/initialized`
3. `tools/list`

A parseable URL alone is `degraded`. A connector becomes `operational` only after the handshake succeeds and at least one tool is declared. Probe logs include connector ID, endpoint origin, correlation ID, duration, stage, HTTP status, and tool count; credentials, query strings, and response bodies are not logged.

Paperclip continues to use its existing REST health/list probe. Its URL alone no longer produces an operational service state.

## Run locally

```powershell
npm ci
npm run dev
```

Set development credentials only through `.env.local` or the approved local secret workflow. Useful non-secret configuration:

```text
MCP_HEALTH_PROBE_TIMEOUT_MS=2500
SMAUTO_MCP_AUTH_MODE=none
```

Use the existing SMAuto and LeadOps environment variables for endpoints and authentication. Never commit their values.

Verify:

```powershell
npm run lint
npm run test:unit
npm run test:smoke
npm run build
```

Then call `GET /api/agents/status` and `GET /api/agents/control-plane` with a development Firebase ID token. Mocked tests cover connector requests; local verification does not require a live external API.

## Deploy

1. Store endpoint credentials in the existing GitHub/Firebase/Cloud Run secret path. Do not place them in source or build arguments.
2. Optionally set `MCP_HEALTH_PROBE_TIMEOUT_MS` between 500 and 10000 milliseconds; the runtime defaults to 2500 milliseconds.
3. Deploy through the repository's standard `main` Firebase App Hosting workflow.
4. Run an authenticated production smoke against `/api/agents/control-plane`; confirm configured MCP services are operational only when the live tool count is nonzero.
5. Send one fresh v1 heartbeat from each active agent/runtime, then confirm `/api/agents/status` shows only the expected org/business/space mappings.
6. Keep consequential external actions approval-gated; this protocol change does not authorize automatic sends, publishing, spend, payments, or contract execution.

Rollback is the prior application revision. The new Firestore heartbeat fields are additive, so no data migration or destructive rollback is required.
