# Runtime Capability Matrix

Last updated: 2026-02-26
Owner: Mission Control

## Goal
Map business capabilities to the backend that serves them, with explicit connector requirements and fallback behavior.

## Matrix

| Capability | Primary backend/tool | Required runtime config | Fallback behavior |
| --- | --- | --- | --- |
| Lead sourcing + qualification | `agency-os-mission-control` APIs (`/api/lead-runs/*`) | `GOOGLE_PLACES_API_KEY` or `APIFY_TOKEN` | Run from CRM-only lead pool when providers are missing |
| Social content orchestration | `SMAuto` MCP endpoint + Mission Control dispatch worker (`/api/social/drafts/dispatch/worker-task`) | `SMAUTO_MCP_SERVER_URL` + (`SMAUTO_MCP_AUTH_MODE` and auth creds), successful `initialize` + `tools/list` probe, `SOCIAL_DRAFT_WORKER_TOKEN` (or OIDC allowlist) | Report the connector degraded and keep content tasks in `social_dispatch_queue` (`pending_external_tool`/`failed`) until the live probe and worker drain succeed |
| Social draft approvals in Google Space | Mission Control Social Draft APIs (`/api/social/drafts*`) + Google Chat webhook | `SOCIAL_DRAFT_WORKER_TOKEN` (or Scheduler OIDC allowlist `SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS`), `SOCIAL_DRAFT_APPROVAL_BASE_URL`, `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL` (or business-specific webhook env) | Keep drafts in `pending_approval` when webhook is unavailable; approved drafts auto-queue as `pending_external_tool` in `social_dispatch_queue` |
| Social onboarding and connection diagnostics | Mission Control onboarding status API (`/api/social/onboarding/status`) + Integrations/Settings UI cards | Firebase user auth, runtime preflight envs, optional `NEXT_PUBLIC_SOCIALOPS_CONNECTIONS_URL` for external account selector CTA | Users can still run manually via runbooks; checklist highlights exact missing step and queue health |
| Research intelligence pulls | OpenClaw research + Firecrawl | `FIRECRAWL_API_KEY` | Continue in reduced mode using standard web search sources |
| Mission-control lead operations tools | Private LeadOps MCP hub endpoint | `LEADOPS_MCP_SERVER_URL`, `LEADOPS_MCP_AUTH_MODE=id_token`, `LEADOPS_MCP_ID_TOKEN_AUDIENCE`, Cloud Run Invoker IAM for the Mission Control runtime identity, and successful `initialize` + `tools/list` probe | Fail closed before network access when identity auth is unavailable; report configured-but-unproven endpoints degraded, keep operator UI active, and block external write actions |
| Email/Calendar execution | Google Workspace tools | OAuth scopes for Gmail + Calendar | Draft-only flow with explicit operator approval |
| Day-1 revenue daily loop (service mode) | Mission Control Day1 APIs (`/api/revenue/day1*`) | `REVENUE_DAY1_WORKER_TOKEN`, lead template + queue envs | Run manually via authenticated `POST /api/revenue/day1` |

## Local run checklist
1. Set env vars in `.env.local` (never commit secrets).
2. Start app: `npm run dev`.
3. Validate runtime checks:
   - UI: `/dashboard/settings` -> **Runtime Config Preflight**
   - API: `GET /api/runtime/preflight`
4. Validate control-plane services (a configured URL is not operational until its bounded live MCP probe passes):
   - UI: `/dashboard/agents` -> **Services + Tools**
   - API: `GET /api/agents/control-plane`

## Deploy checklist
1. Set connector env vars in deployment target (Firebase/Cloud Run secrets or env config).
2. Deploy via standard workflow (`main`) or local `npm run deploy:firebase -- leadflow-review`.
3. Post-deploy smoke:
   - `GET /api/runtime/preflight` returns expected connector state.
   - `GET /api/agents/control-plane` includes `smauto_mcp` and `leadops_mcp` services.
