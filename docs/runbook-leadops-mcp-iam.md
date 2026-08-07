# LeadOps MCP IAM Runbook

Mission Control calls the LeadOps tools through the private `ai-cofoundry-mcp-hub` Cloud Run service. Cloud Run verifies the caller's Google-signed ID token before the MCP application receives the request.

## Runtime contract

```text
LEADOPS_MCP_SERVER_URL=https://ai-cofoundry-mcp-hub-7irsjzrysa-uc.a.run.app/mcp
LEADOPS_MCP_AUTH_MODE=id_token
LEADOPS_MCP_ID_TOKEN_AUDIENCE=https://ai-cofoundry-mcp-hub-7irsjzrysa-uc.a.run.app
```

The audience is the service base URL, never the `/mcp` path. The Mission Control runtime service account must have `roles/run.invoker` on the hub. No static key is needed in ID-token mode.

## Local verification

```powershell
npm ci
npm test -- tests/unit/mcp-connector-health.test.ts
npm run test:smoke
npm run lint
npm run build
```

Application Default Credentials used locally must be able to mint an ID token for the configured audience. Tests mock token minting and do not contact Google.

## Deployment and smoke

The merge workflow updates all three runtime variables together and records the prior Cloud Run revision before traffic moves. After deployment:

1. Confirm `GET /api/runtime/preflight` reports `leadops_mcp` operational.
2. Confirm `GET /api/agents/control-plane` reports a nonzero LeadOps MCP tool count.
3. Confirm logs contain `connector.mcp.probe_completed` with the request correlation ID and no token material.
4. Confirm an unauthenticated POST to the hub returns HTTP 401/403.

## Rollback

Use the prior revision printed by the merge workflow:

```powershell
gcloud run services update-traffic ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --to-revisions <PRIOR_REVISION>=100
```

Do not make the MCP hub public during a Mission Control rollback. If the old application revision lacks ID-token support, leave LeadOps visibly degraded until the repaired revision is restored.
