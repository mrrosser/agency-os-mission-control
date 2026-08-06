# Google Workspace Multi-Profile UI/API

## Objective

Make Mission Control's Google OAuth UI and browser APIs use the same canonical
organization profiles as the schema-v2 revenue workers:

- `rt_solutions` -> `rt_solutions_work`
- `rosser_nft_gallery` -> `rosser_gallery_work`

The product label for `rosser_nft_gallery` is **Rosser Gallery**. The internal
business id remains unchanged so the UI and worker cannot drift.

## Safety and data boundaries

- Keep OAuth credentials in Secret Manager only.
- Store only schema version, account binding, scope, and health metadata in
  Firestore.
- Fail closed on an unknown or mismatched business/profile selection; never
  borrow the legacy account or the other organization's account.
- Keep the no-context legacy connect/status contract for older callers.
- This change does not execute OAuth, send Gmail, or create Calendar events.

## Plan and status

1. Trace schema-v2 profile selection through workers and OAuth routes. Status:
   completed.
2. Add the canonical shared profile contract and profile-aware status API.
   Status: completed.
3. Persist OAuth callbacks to the selected schema-v2 binding, with an
   idempotent profile-derived account id for a new binding. Status: completed.
4. Render independent RT Solutions and Rosser Gallery connection controls.
   Status: completed.
5. Add mocked unit/smoke coverage and run repository quality gates. Status: in
   completed.

## Verification

```powershell
npm ci --no-audit --no-fund
npx vitest run tests/unit/google-business-profiles.test.ts tests/unit/google-account-token-store.test.ts tests/unit/google-connect-route.test.ts tests/unit/google-callback-route.test.ts tests/unit/google-status-route.test.ts tests/smoke/google-workspace-connect.test.tsx
npx eslint lib/google/business-profiles.ts lib/google/account-token-store.ts lib/google/oauth.ts app/api/google/connect/route.ts app/api/google/callback/route.ts app/api/google/status/route.ts components/integrations/GoogleWorkspaceConnect.tsx app/dashboard/integrations/page.tsx tests/unit/google-business-profiles.test.ts tests/unit/google-account-token-store.test.ts tests/unit/google-connect-route.test.ts tests/unit/google-callback-route.test.ts tests/unit/google-status-route.test.ts tests/smoke/google-workspace-connect.test.tsx
npx tsc --noEmit --incremental false --pretty false
npm run test:unit
npm run test:smoke
npm run build
```

Verification on 2026-08-06:

- Focused profile suite: 22 tests passed.
- Full lint, TypeScript, smoke suite, and production build: passed.
- Full unit suite: 301/302 passed under the default 5-second test ceiling; the
  unchanged `api-secrets-fallback` timing test passed in isolation with
  `--testTimeout=15000`.
- `npm audit --audit-level=high --omit=dev`: reports the repository's existing
  dependency backlog (23 vulnerabilities). This scoped change does not modify
  dependencies; remediation belongs in the dependency-upgrade workstream.

## Deployment and rollback

Deploy through the protected Firebase/Cloud Run PR-to-main workflow documented
in the repository. Do not connect accounts as part of deployment. After the
revision is healthy, an authenticated operator can verify `/api/google/status`
and then explicitly complete OAuth for a profile that reports disconnected.

Rollback by restoring the prior application revision. Schema-v2 documents are
backward compatible with the workers; rolling back the UI does not require
deleting bindings or Secret Manager versions.
