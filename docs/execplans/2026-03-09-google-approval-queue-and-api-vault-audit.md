# ExecPlan: Google Token Audit, Approval Queues, and API Vault Cleanup

Date: 2026-03-09
Owner: Mission Control
Status: Complete

## Goal

Make Mission Control reliable after login by:

- removing confusing Gmail/Calendar token failures from the dashboard
- showing approval-focused email/calendar work instead of raw provider feeds
- simplifying the API Vault so Google auth, white-label login, and per-environment API keys each have a clear place

## Why this plan exists

- The current Google flow defaults many users into a partial connection (`core` scopes), but Inbox still behaves like Gmail access is guaranteed.
- Calendar and Gmail pages surface raw provider state instead of the operational queue Mission Control already tracks through lead-run receipts.
- Settings duplicates connection/setup guidance with Integrations, which makes the API Vault feel redundant and noisy.

## Scope

- Google OAuth capability detection and token error handling.
- Dashboard Inbox and Calendar behavior for approval-focused work.
- Settings/API Vault and Integrations UX cleanup.
- Targeted unit/smoke coverage for new gating and queue logic.

## Out of Scope

- Rebuilding the Agent Matrix pricing/spend model.
- New billing, CRM, or social dispatch product surfaces.
- Changing how lead-run workers create drafts/events beyond the metadata needed for dashboard views.

## Definition of Done (DoD Gates)

- [x] Gmail/Calendar routes fail with actionable reconnect/enable-scope messages, not opaque token errors.
- [x] Inbox defaults to drafted/review-needed email work items backed by lead-run receipts.
- [x] Calendar defaults to lead-run booking work items backed by lead-run receipts.
- [x] Settings/API Vault clearly separates Google account connection from optional BYO secret storage.
- [x] Integrations copy no longer implies every logged-in user must paste keys before using the app.
- [x] `npm run test:unit` passes.
- [x] Relevant targeted smoke/unit tests pass for Google capability gating and approval queue transforms.
- [x] `npm run build` passes.

## No Feature Creep

- Keep the work centered on reliability, filtering, and UX clarity.
- Do not redesign unrelated dashboard pages.
- Do not change the Agent Matrix except to preserve current behavior.

## Milestones

### M0) Audit baseline

- Trace Google connect/status/callback/token code.
- Confirm Inbox/Calendar current behavior vs receipt-backed workflow.
- Identify duplicated setup copy between Integrations and Settings.

### M1) Google auth reliability

- Add reusable Google capability parsing + required-capability checks.
- Return reconnect messaging on expired/revoked Google tokens.
- Gate Gmail and Calendar endpoints on the required scopes before hitting Google APIs.

### M2) Approval queue views

- Build a receipt-backed helper that pulls recent Gmail draft and calendar booking actions for the current user.
- Replace raw Inbox/Calendar dashboard feeds with approval-focused mission work items.
- Preserve lead, run, and external-link context needed for operator review.

### M3) API Vault cleanup

- Reduce duplication between Integrations and Settings.
- Make Google auth clearly a connected-account flow, not an API-key flow.
- Reframe the vault as optional BYO vendor credentials for environments that need them.

### M4) Regression protection

- Add unit coverage for Google capability logic and approval queue transforms.
- Add route-level smoke coverage where practical.
- Run build + tests after implementation.

## Risks

- Firestore query shape for receipt aggregation could drift into index-heavy patterns.
  Mitigation: prefer simple user-scoped scans and in-memory sorting for the initial fix.
- Existing users may have stale/partial Google tokens.
  Mitigation: treat invalid/revoked refresh failures as reconnect-required and surface precise guidance.
- Approval-only filtering may hide raw provider data some operators still expect.
  Mitigation: keep copy explicit that these pages show Mission Control work items, not the full provider inbox/calendar.

## Files Likely To Change

- `app/api/google/status/route.ts`
- `app/api/gmail/inbox/route.ts`
- `app/api/gmail/draft/route.ts`
- `app/api/gmail/send/route.ts`
- `app/api/calendar/events/route.ts`
- `app/dashboard/inbox/page.tsx`
- `app/dashboard/calendar/page.tsx`
- `app/dashboard/settings/page.tsx`
- `app/dashboard/integrations/page.tsx`
- `components/integrations/GoogleWorkspaceConnect.tsx`
- `lib/google/oauth.ts`
- `lib/lead-runs/receipts.ts`
- new approval-queue helper/route files
- targeted tests under `tests/unit` and `tests/smoke`

## Verification Commands

- `npm run test:unit`
- `npx vitest run <targeted test files>`
- `npm run build`

## Progress Notes

- 2026-03-09: Root-cause audit completed. Confirmed the current mismatch between partial Google scope onboarding and Inbox’s Gmail assumptions; confirmed receipt data already contains enough Gmail draft and calendar booking metadata to drive approval-focused dashboard pages.
- 2026-03-09: Added runtime Google token validation to status/audit surfaces, gated Operations drive polling on actual Drive scope, hardened lead-run/followup/voice workers to skip missing Google capabilities cleanly, deployed to `leadflow-review`, and passed post-deploy smoke on `https://leadflow-review.web.app`.
