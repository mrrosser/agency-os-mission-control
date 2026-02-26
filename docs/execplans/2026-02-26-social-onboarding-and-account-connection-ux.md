# ExecPlan: Social Onboarding + Account Connection UX

Date: 2026-02-26  
Owner: Mission Control + SMAuto  
Status: In Progress

## Goal

Make the end-to-end experience reliable and fast from first login to connected social accounts, approved drafts, and successful dispatch.

## Why this plan exists

- We now have approved Meta app access on the correct app, but operators still hit avoidable connection friction.
- Mission Control social draft approvals are live, but dispatch reliability still depends on runtime connector setup (`SMAUTO_MCP_SERVER_URL`).
- We need one deterministic onboarding path that works for operators and external clients.

## Scope

- Onboarding UX in Mission Control (operator readiness + action checklist).
- Connector readiness + diagnostics between Mission Control and SMAuto.
- Social account connection flow quality (SMAuto connections UX and account selection flow).
- Approval-to-dispatch observability (Google Space + status notifications).
- Regression tests, runbooks, and rollout checklist.

## Out of Scope

- New ad-management product surfaces.
- Fully autonomous posting with no human approval.
- Model-weight training pipeline (kept in separate ML execution plan).

## Definition of Done (DoD Gates)

- [x] `npm run lint` passes.
- [x] `npm run test:unit` passes.
- [x] `npm run test:smoke` passes.
- [x] Social flow tests pass:
  - `npx vitest run tests/unit/social-drafts.test.ts tests/unit/social-dispatch.test.ts tests/unit/social-worker-auth.test.ts tests/smoke/social-drafts-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/social-draft-decision-route.test.ts tests/smoke/social-drafts-dispatch-worker-task-route.test.ts`
- [ ] Runtime preflight confirms connector readiness in deployed env (`GET /api/runtime/preflight`).
- [ ] `docs/runbook-social-draft-approvals.md` and this plan updated with final rollout notes.
- [ ] `docs/reports/latest-run.md` updated with RUN_ID + gate results.

## No Feature Creep (Hard Stop)

- In scope is onboarding + social connection + approval/dispatch reliability only.
- Any request outside this scope requires a new execplan entry before implementation.

## Milestones

### M0) Immediate reliability blockers (must finish first)
- Set and verify `SMAUTO_MCP_SERVER_URL` in production runtime.
- Verify `SMAUTO_MCP_AUTH_MODE` and auth credentials (id_token/api_key) align with SMAuto endpoint.
- Run dispatch worker dry-run and live run; confirm failed queue items drain.
- Confirm scheduler jobs are active:
  - `social-dispatch-drain`
  - `social-dispatch-retry-failed`

### M1) Mission Control onboarding funnel (this repo)
- Add a single onboarding checklist surface that gates "ready to run" state:
  - Google connected
  - social dispatch connector reachable
  - approval webhook configured
  - worker auth configured
- Add direct CTA links to integrations/settings and social runbook docs.
- Persist onboarding progress per identity so users can resume.

### M2) Social account connect UX hardening (SMAuto repo)
- Keep one canonical IG/FB connector card (remove duplicate path permanently).
- Improve OAuth diagnostics for redirect/domain mismatch:
  - show active app ID in UI
  - show callback URI used
  - show copyable fix steps
- Improve Page + Instagram selector UX:
  - explicit account pairing preview
  - save confirmation + health check result
  - clear re-auth path if token stale

### M3) Approval and mobile operations loop
- Keep Google Space approval as primary mobile entry point.
- Include post-approval dispatch status notifications by business in Google Space.
- Add retry action guidance when dispatch fails (from card + runbook).
- Ensure approval links are single-use safe and idempotent.

### M4) Observability and regression prevention
- Add correlation-id breadcrumbs across approval -> queue -> dispatch -> status notify.
- Add dashboard health panel for social pipeline:
  - pending approvals
  - pending dispatch
  - failed dispatch
  - last successful dispatch timestamp
- Add one smoke check script for social pipeline end-to-end health.

### M5) Rollout and acceptance
- Internal acceptance (RNG) for 7-day draft/approval/dispatch cycle.
- External client acceptance (at least one non-admin user path).
- Final runbook and escalation section updated.

## Progress update (2026-02-26)

- Added MCP protocol/session hardening in `lib/social/dispatch.ts`:
  - default protocol header `MCP-Protocol-Version: 2025-03-26`
  - `Accept: application/json,text/event-stream`
  - session bootstrap flow (`initialize` -> `notifications/initialized` -> retry `tools/call`) when server reports missing session ID
- Added/updated coverage in `tests/unit/social-dispatch.test.ts` for protocol headers and session bootstrap retry.
- Added protocol-version env docs in `README.md` and `docs/runbook-social-draft-approvals.md`.
- Ran local gates successfully:
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:smoke`
  - social flow vitest command from DoD
- `npm run social:dispatch:smoke` currently blocked in this shell due missing runtime env vars (`SOCIAL_DISPATCH_SERVICE_URL`, worker token, uid).

## Files to touch (expected)

- `app/dashboard/integrations/page.tsx`
- `app/dashboard/settings/page.tsx`
- `lib/runtime/preflight.ts`
- `lib/social/drafts.ts`
- `lib/social/dispatch.ts`
- `docs/runbook-social-draft-approvals.md`
- `docs/runtime-capability-matrix.md`
- `tests/unit/social-drafts.test.ts`
- `tests/unit/social-dispatch.test.ts`
- `tests/smoke/social-drafts-dispatch-worker-task-route.test.ts`

## External dependencies / coordination

- SMAuto repo implementation for connection UI and OAuth diagnostics.
- Meta app configuration must stay aligned to active app ID + callback URI.
- Google Chat webhook and worker tokens remain in Secret Manager only.

## Risk register

- OAuth config drift between environments -> add explicit environment banner and callback echo.
- Queue buildup if connector endpoint missing -> keep retry scheduler + alerting.
- User confusion with multi-page/multi-IG accounts -> enforce explicit selector + saved pairing evidence.

## Verification commands

- `npm run lint`
- `npm run test:unit`
- `npm run test:smoke`
- `npx vitest run tests/unit/social-drafts.test.ts tests/unit/social-dispatch.test.ts tests/unit/social-worker-auth.test.ts tests/smoke/social-drafts-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/social-draft-decision-route.test.ts tests/smoke/social-drafts-dispatch-worker-task-route.test.ts`

## Exit criteria

- A new external user can complete onboarding and connect social accounts without manual backend intervention.
- Approved social drafts dispatch successfully through SMAuto for at least 7 consecutive days.
- Failures are visible and actionable from UI + Google Space without digging into raw logs.
