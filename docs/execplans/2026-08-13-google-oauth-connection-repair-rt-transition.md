# Google OAuth connection repair and RT.Solutions transition

## Goal

Make every supported Google connection complete successfully for a correctly
authorized user, keep credentials tenant- and profile-bound, return users to a
helpful in-app result instead of raw callback JSON, and retire the remaining
active AICF / AI Co-Foundry runtime path in favor of the canonical
RT.Solutions profile and automation.

## Confirmed incident

- Two production attempts reached `/api/google/callback` and failed after code
  exchange with `Google returned a broader or incomplete grant than the
  Gmail-send profile allows` (correlations
  `d7977cc4-3936-4b40-9b81-12ed81264eee` and
  `74f3610b-7d44-4c27-b710-96529b851f36`).
- The callback required the token response scope set to equal exactly
  `userinfo.email + gmail.send`. The two live responses instead contained the
  requested scopes plus Google's harmless `openid` and `email` identity
  aliases. The application must accept those aliases while rejecting every
  unrequested Drive, Calendar, Contacts, Gmail-content, or unknown scope.
- The successful authorization code currently falls through to a raw API error
  page on any post-state failure. The user receives no safe retry guidance.
- The OAuth state is one-time and expiring, but it is not bound to the browser
  session that initiated the connection. This leaves an account-linking CSRF
  boundary to close before supporting other platform users.
- Some legacy connection surfaces still omit business/profile context and can
  store a legacy token outside the schema-v2 profile/Secret Manager path.
- Production did not set `MISSION_CONTROL_PUBLIC_ORIGIN`, so both attempts
  stored `https://0.0.0.0:8080` as their return origin. Deployment must pin and
  verify `https://leadflow-review.web.app` before promotion.
- The enabled `revenue-automation-aicf` scheduler and `aicf` business context
  are legacy. They must not remain an independent active automation after the
  RT.Solutions transition.

## Authority and safety boundary

- Do not initiate Google consent, choose a Google account, access mailbox
  content, or expose/revoke credentials without the account owner's explicit
  interaction.
- Keep Rosser Gallery and RT.Solutions as distinct, server-authorized profiles
  backed by different Google subjects; never substitute the currently
  signed-in personal Gmail account or share a grant between profiles.
- A connection may be considered Gmail-send capable only when the returned
  grant contains `gmail.send`, verified email identity, and only the allowed
  OIDC identity aliases. Unexpected data scopes fail closed.
- State must be single-use, ten-minute bounded, browser-bound with a Secure
  HttpOnly SameSite cookie, and safe under concurrent callbacks.
- All terminal callback outcomes redirect to an allowlisted app path with a
  stable error code. Never reflect provider descriptions, authorization codes,
  token data, or raw callback URLs.
- Provider calls, campaign sending, and warm-reconnect scheduling remain off.
- Transition the active AICF runtime reversibly: stop duplicate scheduling and
  bind supported current automation to RT.Solutions. Preserve historical IDs
  only where changing them would corrupt existing receipts or audit history.

## Implementation checklist

- [x] Replace exact returned-scope equality with per-preset bounded authority.
- [x] Add browser-bound PKCE OAuth state and callback-cookie verification.
- [x] Redirect all post-state OAuth failures to the initiating app screen with
  safe retry copy and correlation.
- [x] Remove legacy plaintext/UI token connection paths; require schema-v2
  business/profile bindings and Secret Manager storage.
- [x] Add an explicit default-profile selection for generic Google tools and
  fail closed instead of guessing across organization accounts.
- [x] Add profile-specific local disconnect that cannot affect another tenant
  or business profile. Ordinary disconnect never invokes Google's project-wide
  revocation endpoint; a future "revoke everywhere" flow is explicitly out of
  scope until it has global ownership/reference-count protection.
- [x] Delete a superseded OAuth state immediately; provision/document TTL for
  abandoned state and attempt records before activation. On 2026-08-13,
  Firestore TTL was enabled on `expiresAt` for `google_oauth_state` (ACTIVE)
  and `google_oauth_connect_attempts` (ACTIVE), verified before deployment.
- [x] Make Secret Manager user keys collision-resistant with safe, symmetric
  backward-compatible
  reads for existing credentials.
- [x] Pin and candidate-verify the canonical public origin in both deployment
  workflows. The first PR run exposed that a zero-traffic preview revision is
  not `latestReadyRevisionName`; the repaired workflow now creates and checks a
  uniquely named, no-traffic revision derived from the Firebase-deployed image.
- [x] Transition active AICF / AI Co-Foundry scheduler and user-facing runtime
  configuration to RT.Solutions without duplicating jobs.
- [x] Add unit, smoke, and browser tests with Google and Secret Manager mocked.
- [x] Pass TypeScript, lint, full unit/smoke, production build, dependency audit,
  Gitleaks, diff checks, and independent security review.
- [ ] Merge through protected exact-head CI, deploy with the current workflow,
  and verify live success/error redirects plus RT.Solutions runtime ownership.

## Verification

Tests must cover required plus extra granted scopes, missing `gmail.send`,
missing verified email, browser-cookie mismatch, expired/replayed state,
concurrent callbacks, cross-account reconnect, cross-tenant isolation, safe
error redirect, schema-v2 storage only, profile disconnect, and AICF-to-RT
runtime mapping. External Google APIs and credential storage are mocked.

Local gates:

```powershell
npx vitest run tests/unit/google-*.test.ts tests/smoke/google-*.test.ts
npx tsc --noEmit --incremental false
npm run lint
npm run test:unit
npm run test:smoke
npm run build
npm audit --audit-level=high
git diff --check
```

OAuth transient-record TTL provisioning and verification:

```powershell
gcloud firestore fields ttls update expiresAt --collection-group=google_oauth_state --enable-ttl --project=leadflow-review --database='(default)'
gcloud firestore fields ttls update expiresAt --collection-group=google_oauth_connect_attempts --enable-ttl --project=leadflow-review --database='(default)'
gcloud firestore indexes fields describe expiresAt --collection-group=google_oauth_state --project=leadflow-review --database='(default)'
gcloud firestore indexes fields describe expiresAt --collection-group=google_oauth_connect_attempts --project=leadflow-review --database='(default)'
```

## Deployment and rollback

Capture the exact Hosting version, SSR revision/digest/traffic, scheduler state,
OAuth environment variable names (never values), and branch-protection policy
before release. Deploy through the existing Firebase/SSR workflow and verify
both success and safe-error paths without accessing mailbox data. Confirm no
new warm-reconnect sends, no provider scheduler, and no active AICF scheduler.

Rollback code by restoring the prior Hosting version and SSR revision. Restore
the prior scheduler state only if RT.Solutions automation is not healthy; never
run both legacy AICF and replacement RT jobs concurrently. Credential records
and user revocations are audit state and must not be deleted during a code
rollback.
