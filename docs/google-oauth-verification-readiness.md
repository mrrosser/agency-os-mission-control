# Google OAuth Verification Readiness

Last updated: 2026-02-21

## Goal
Keep the app continuously ready for Google OAuth branding/scopes verification with repeatable checks.

## Current app URLs
- Login/Home for consent review: `https://leadflow-review.web.app/login`
- Privacy policy: `https://leadflow-review.web.app/privacy`
- Terms of service: `https://leadflow-review.web.app/terms`

## Quick checks
1. Public page check (no auth):
   - `npm run check:oauth-readiness -- https://leadflow-review.web.app`
2. Authenticated API report:
   - `GET /api/google/verification-readiness?baseUrl=https://leadflow-review.web.app`
3. Runtime config baseline:
   - `GET /api/runtime/preflight`

## Verification checklist
- **Branding**
  - App name in Google Auth Platform matches visible app name on login page.
  - Homepage URL is owned/verified by your org.
  - Privacy policy URL and terms URL are live and linked from login/homepage.
- **Domain ownership**
  - Prefer custom domain over default `web.app` domain for smoother verification.
  - Verify domain ownership in Search Console.
- **Scopes**
  - Only request minimum required scopes.
  - Scope justification and data-use text match implementation.
- **Demo readiness**
  - Test account prepared.
  - Stable step-by-step demo flow for reviewer.

## Recommended evidence pack
- Screenshots:
  - Login page showing app name + privacy/terms links.
  - Privacy and terms pages.
  - Google OAuth consent screen settings.
- Text artifacts:
  - Scope-by-scope justification.
  - Data retention/deletion statement.
  - Support contact + escalation path.

## Notes
- If verification fails on branding mismatch, resolve app name consistency first.
- If reviewers flag policy-link issues, ensure links are visible from the initial login/home surface.
