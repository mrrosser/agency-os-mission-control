# Google connection recovery

Restore the existing Google connection workflow behind Firebase Hosting and recover interrupted CRM connection UI without changing account pins, scopes, consent, send approval, CI gates, or runtime credentials.

## Evidence and scope

Production connect requests completed with HTTP 200, followed seconds later by `oauth.callback.state_rejected` / `invalid_browser_binding_or_state`. Firebase Hosting forwards only the `__session` cookie; the old per-state `__Host-mc-google-oauth-*` cookie therefore cannot reach the callback through Hosting. See https://firebase.google.com/docs/hosting/manage-cache#using_cookies.

The client also lacked an overall token/fetch/body deadline, browser-restoration handling and consistent prevention of repeated connects. Callback feedback could disappear when its query parameters were removed, and CRM reopened People instead of Outreach.

## Implementation boundaries

- Use a host-only, Secure, HttpOnly, SameSite=Lax `__session` cookie scoped to `/api/google`. It contains a short-lived random browser anchor, independent of Firebase Auth's root-path session cookie. Derive a different PKCE verifier for each exact state using domain-separated HMAC-SHA256. Refresh the same anchor's ten-minute lifetime when starting a connection.
- Preserve state freshness, latest-attempt ownership, transaction consumption, callback account identity and exact scope checks. Never accept the anchor as application authentication. Reject malformed/ambiguous anchor cookies; do not log their values.
- Do not rewrite the shared anchor during callback cleanup: a delayed callback must not delete a newer connection. Retain legacy per-state reading/cleanup solely for already-started attempts on hosts that forward those cookies.
- Bound the CRM read-only status and connect operations; cancel and ignore stale work on owner changes, unmount, browser restoration or explicit status refresh. Retry only on an explicit new click. Surface recovery beside the sender controls.
- Retain safe callback feedback after URL cleanup and select Outreach when CRM receives a recognized result.
- Diagnose autonomy policy and health separately. Do not change either based on CI success.

## Verification and release boundary

Run complete unit/smoke tests, TypeScript, lint, production build, unchanged dependency/secrets gates, isolated mocked mobile browser cases, and an independent security/correctness review. Test Hosting-style cookie forwarding, root-cookie coexistence in both orders, malformed/duplicate cookies, wrong browser/state, stale/superseded/replayed callbacks, repeated initialization and late callbacks. No live OAuth or provider send is a test.

Known transport limit: two simultaneous first-ever initializations without an existing anchor may create different anchors; only the browser's retained anchor can complete. The other attempt fails closed and requires an explicit fresh attempt. No callback can restore a losing anchor. Duplicate same-name cookie forwarding through the live CDN is modeled locally, not established by a user OAuth round trip.

The candidate changes authentication transport and needs explicit publication-scope review before protected PR/merge/deployment. Existing completed releases are preserved. No new credential, OAuth client setting, scope, runtime secret, dependency, workflow, or policy change is planned. Current verification results belong in `docs/reports/2026-10-04-google-connection-recovery.md`.
