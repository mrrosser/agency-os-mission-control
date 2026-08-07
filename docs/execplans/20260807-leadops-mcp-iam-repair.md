# Mission Control LeadOps MCP IAM Repair

## Goal

Make the LeadOps connector use the real private MCP hub with Cloud Run ID-token authentication and prove the connector through the existing live MCP health handshake.

## Context

- The deployed URL targets `leadops-engine`, not an MCP server; POST `/mcp` returns HTTP 405.
- The real endpoint is `https://ai-cofoundry-mcp-hub-7irsjzrysa-uc.a.run.app/mcp` with audience `https://ai-cofoundry-mcp-hub-7irsjzrysa-uc.a.run.app`.
- SMAuto already establishes the local ID-token pattern. LeadOps currently supports only an optional static API key.
- Paperclip has no production URL/token/company configuration, so health must remain truthful and degraded/optional.

## Approach

- Add `LEADOPS_MCP_AUTH_MODE=none|api_key|id_token` and `LEADOPS_MCP_ID_TOKEN_AUDIENCE`.
- Preserve backward compatibility by defaulting to `api_key` when `LEADOPS_MCP_API_KEY` exists and `none` otherwise.
- Fail closed without a network call when auth cannot be established. Log a structured `connector.mcp.probe_skipped` event with the correlation ID, never credential material.
- Add mocked unit tests for successful ID-token probing and missing-audience failure.
- Update both deployment workflows, docs, and runtime capability matrix.

## Risks & Mitigations

- URL cutover before IAM is ready would make production degraded: change production config only after an authenticated hub handshake succeeds.
- Wrong audience would fail token verification: use the Cloud Run service base URL, not `/mcp`, and test it before deploy.
- Workflow regressions: run targeted unit, smoke, lint/type/build checks and use the workflow's existing postdeploy rollback path.

## Testing

- `npm test -- tests/unit/mcp-connector-health.test.ts`
- Relevant smoke tests for runtime preflight/control-plane.
- `npm run lint`
- `npm run build`
- Postdeploy authenticated runtime preflight and control-plane checks.

## Rollout

1. Grant the Mission Control runtime service account `roles/run.invoker` on the secured MCP hub.
2. Verify an ID-token MCP handshake as that identity.
3. Deploy a new Mission Control revision with the hub URL/auth mode/audience.
4. Verify connector state and logs, then keep the new revision at 100% traffic.

Backout: use the deployment workflow's captured prior revision or run `gcloud run services update-traffic ssrleadflowreview --to-revisions=<recorded-prior-revision>=100 --region us-central1 --project leadflow-review`. The hub remains private during rollback.

## Done When

- LeadOps live probe succeeds with a minted ID token and nonzero tools.
- Missing/invalid auth fails closed without network access.
- Production Mission Control points only at the private MCP hub and retains a documented rollback revision.
