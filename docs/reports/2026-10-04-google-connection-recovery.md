# Google connection recovery — local candidate

The production sender-connect endpoint completed successfully, but callbacks were rejected before token exchange because the browser binding could not be verified. The previous browser cookie cannot pass Firebase Hosting's cookie filter. This candidate restores the transport and makes interrupted CRM connections recover visibly.

## Changes

- A host-only, Secure, HttpOnly, SameSite=Lax `__session` cookie scoped to `/api/google` carries a ten-minute browser anchor. Each state gets a distinct HMAC-derived PKCE verifier; only its challenge enters stored state. Firebase Auth's root cookie is not overwritten. The raw cookie reader handles both cookie orders and rejects malformed or ambiguous application bindings.
- Exact pending legacy cookies remain usable alongside newer profile attempts. Callback cleanup never rewrites the shared anchor, preventing a delayed callback from clearing a newer attempt. State expiry, latest-attempt checks, single-use transaction consumption, scope restrictions and account pins remain enforced.
- An overall twenty-second client deadline includes auth, fetch and parsing. Cancellation on owner changes, unmount, browser restoration and explicit refresh prevents late responses from navigating. Both buttons reflect the single active connection; retries require a new click. Status refresh only reads status.
- Connection errors are adjacent to sender controls. Recognized callback feedback selects CRM Outreach and persists after safe URL cleanup, but only within the authenticated owner's mounted session.

No account scope, sender identity, pilot approval/launch requirement, runtime secret, credential, CI workflow, dependency or autonomy policy changes are included.

## Validation

- Complete unit/smoke suite: 1,635 tests in 248 files passed (`npm test -- --maxWorkers=4`). The bounded worker count prevents contention with concurrent browser tests; it does not exclude tests or relax assertions.
- Whole-checkout TypeScript passed. Full lint passed with zero errors and two pre-existing callback-route warnings.
- Unchanged high-severity dependency gate passed: zero high/critical; sixteen existing moderate findings remain.
- Seven sender recovery browser cases passed. All five final callback cases passed, including a real mounted owner switch without reloading the document. All API/provider traffic was mocked or blocked and the isolated server was stopped.
- Production build passed, including type checking and all 91 static pages. Dummy Firebase client settings were used only for local validation; never deploy this generated build artifact. Protected release CI must rebuild the reviewed source with its existing configuration.
- Exact staged patch Gitleaks scan passed with no findings; diff whitespace check passed.
- Independent review identified mixed legacy/current-cookie compatibility and feedback surviving owner changes; both were corrected. Follow-up review found no remaining concrete issue.

Earlier full-suite failures were old UI state/source fixture expectations and one import timeout under high concurrency; the fixtures were updated to exercise the moved helper and owner-bound activation, then the complete suite passed. An earlier browser run timed out during page hydration before any connect action; the local readiness wait was corrected and all eleven initial cases passed. The new owner-switch regression then caught Next.js retaining an old search-parameter snapshot after URL cleanup. Reading the actual current URL before consuming metadata fixed that issue; the unchanged regression and all five final callback cases passed, followed by all 1,635 unit/smoke tests again. Original failure logs are preserved outside the checkout.

## Limits and publication

Tests use synthetic identities and mocked APIs with external traffic blocked. They do not prove a live Google grant or email delivery. Hosting-style filtering and duplicate-cookie ordering are modeled locally; actual CDN behavior with both a Firebase root cookie and scoped browser cookie remains a user-attended post-deployment verification item. Simultaneous first-ever connection initialization can lose one bootstrap anchor; that attempt fails closed and requires an explicit retry. This is not an authorization bypass.

Firebase framework middleware may emit its static invalid-session warning when it encounters the scoped non-JWT anchor on Google routes; it continues routing, and these endpoints continue to require explicit bearer authentication or browser-bound state. The anchor is not accepted as an app login.

This isolated candidate's starting tree matches production/main `7a83b6f20bd4e822cd02aa39a1f2b1adb0cad758` (main rechecked read-only). Production has not been changed. The available handoffs do not establish that prior publication approval covers this newly proposed shared authentication transport. Under the delegation's instruction to pause when risk/scope changes, obtain confirmation for this exact tested repair before protected PR/merge/deployment; no new access, OAuth scopes or credentials are needed.

The operator must start a fresh connection from the phone CRM after publication and personally complete consent in that browser. Connection does not approve or send any campaign. The autonomy indicator is separate from CI: no owner policy record was found in the read-only check, so the current app defaults both businesses to Assist. Do not alter runtime policy or health colors to match a build result.

Design and scope: `docs/execplans/2026-10-04-google-connection-recovery.md`. Hosting behavior: https://firebase.google.com/docs/hosting/manage-cache#using_cookies.
