# Runtime Capability Matrix

Last updated: 2026-02-24
Owner: Mission Control

## Goal
Map business capabilities to the backend that serves them, with explicit connector requirements and fallback behavior.

## Matrix

| Capability | Primary backend/tool | Required runtime config | Fallback behavior |
| --- | --- | --- | --- |
| Lead sourcing + qualification | `agency-os-mission-control` APIs (`/api/lead-runs/*`) | `GOOGLE_PLACES_API_KEY` or `APIFY_TOKEN` | Run from CRM-only lead pool when providers are missing |
| Social content orchestration | `SMAuto` MCP endpoint | `SMAUTO_MCP_SERVER_URL` + (`SMAUTO_MCP_AUTH_MODE` and auth creds) | Queue content tasks locally as `pending_external_tool` |
| Social draft approvals in Google Space | Mission Control Social Draft APIs (`/api/social/drafts*`) + Google Chat webhook | `SOCIAL_DRAFT_WORKER_TOKEN`, `SOCIAL_DRAFT_APPROVAL_BASE_URL`, `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL` (or business-specific webhook env) | Keep drafts in `pending_approval` and approve from dashboard/API if webhook unavailable |
| Research intelligence pulls | OpenClaw research + Firecrawl | `FIRECRAWL_API_KEY` | Continue in reduced mode using standard web search sources |
| Mission-control lead operations tools | LeadOps MCP endpoint | `LEADOPS_MCP_SERVER_URL` (+ optional `LEADOPS_MCP_API_KEY`) | Keep operator UI active; block external write actions |
| Email/Calendar execution | Google Workspace tools | OAuth scopes for Gmail + Calendar | Draft-only flow with explicit operator approval |
| Day-1 revenue daily loop (service mode) | Mission Control Day1 APIs (`/api/revenue/day1*`) | `REVENUE_DAY1_WORKER_TOKEN`, lead template + queue envs | Run manually via authenticated `POST /api/revenue/day1` |

## Local run checklist
1. Set env vars in `.env.local` (never commit secrets).
2. Start app: `npm run dev`.
3. Validate runtime checks:
   - UI: `/dashboard/settings` -> **Runtime Config Preflight**
   - API: `GET /api/runtime/preflight`
4. Validate control-plane services:
   - UI: `/dashboard/agents` -> **Services + Tools**
   - API: `GET /api/agents/control-plane`

## Deploy checklist
1. Set connector env vars in deployment target (Firebase/Cloud Run secrets or env config).
2. Deploy via standard workflow (`main`) or local `npm run deploy:firebase -- leadflow-review`.
3. Post-deploy smoke:
   - `GET /api/runtime/preflight` returns expected connector state.
   - `GET /api/agents/control-plane` includes `smauto_mcp` and `leadops_mcp` services.
