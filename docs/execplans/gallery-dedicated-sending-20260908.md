# Dedicated Rosser Gallery sending connection

## Scope and authority

Local implementation based on frozen release `fdcfd2afbfd5fb58341623509ca63485a4ec725e`. The user confirmed `mrosser@rossergallery.com` as both the Google OAuth account and visible From address. This change does not authorize a campaign, reconnect a provider, modify live credentials, or deploy. Existing approval, scope, consent, and executor gates remain in place.

Main-task release authorization: Marcus explicitly requested publication with email sending capability enabled, preservation of existing Google access, and removal of the extra human reviewer. Required review count is now zero only on this repository's main; all automated/protection gates remain. The first repair release passed the protected pipeline and fresh live browser verification. This isolated follow-up was fast-forwarded to its tree-identical merge base `eff63178ba453f17484534f2dbe5b8f623769bf7`. After fresh PR checks, publish through that same pipeline with durable `WARM_RECONNECT_PROVIDER_SEND_ENABLED=true`. This enables capability only, not OAuth consent, recipient selection, campaign approval, scheduling, or sending. The implementation subtask itself performed no deployment.

## Design

- Keep `rosser_gallery_work` and its Drive, Calendar, and inbox-reading credentials unchanged.
- Add explicit `rosser_gallery_send`, limited to `gmail_send`, with the confirmed Gallery identity checked server-side.
- Give the dedicated profile its own credential namespace, even when Google returns the same stable account subject as the work profile. Existing profile identifiers, credential hashes, and general default routing remain unchanged.
- Do not allow the sending connection to become a general Google default or silently reuse a work/personal connection.
- Show the separate connection in the CRM Outreach activation desk. General Integrations stays the work-connection surface.
- Disconnect continues to remove only the selected local profile, without provider-wide token revocation.

## Steps and validation

- [x] Inspect profile routing, OAuth scope/identity checks, credential storage, and local-only disconnect.
- [x] Implement dedicated profile and server-side guards, including legacy-registry rejection before writes and old-work-profile pilot rejection.
- [x] Update CRM activation mapping and clear separate-connection wording.
- [x] Add mocked regression tests for credential isolation, pinned identity, exact scopes, default/fallback prevention, callback/connect behavior, and UI mapping.
- [x] Run full unit/smoke tests and TypeScript; record results below.
- [x] Finish full lint and redacted secrets/dependency checks.
- [x] Finish isolated production build and mocked desktop/mobile browser check.

## Local operation, release, and rollback

Use the existing matching dependency lock and run `npm run test:unit -- --maxWorkers=2`, `npm run test:smoke -- --maxWorkers=2`, `npx tsc --noEmit`, and `npm run lint`. No live APIs are needed for these mocked tests. Use the repository's reviewed PR/main deployment pipeline in a later authorized release; do not alter the currently frozen CRM release. Rolling back this code hides the new connection without overwriting or deleting the work connection. No credential migration or default change is part of this patch.

Fresh September 8 release preflight: zero warm pilots; zero warm-reconnect Scheduler targets among 25 jobs across 30 supported locations. Cloud Tasks were not enumerated. The live repair has all three worker configuration entries, and its release pipeline checked their exact approved configuration. All five existing Second Brain secret references match their approved `latest` selectors. Coordinated rollback baseline: Hosting version `24569427a017c0dd`, rewrite tag `release-34266245623-1`, runtime `ssrleadflowreview-release-34266245623-1` at 100%. Refresh before rollback and refuse to overwrite unrelated newer state. Revert the durable provider flag to false through the normal pipeline first if activation must be withdrawn; never delete or replace existing work credentials.

After a later publish, Marcus opens CRM → Outreach → Choose the sending Google account → Connect Gallery sending, selects `mrosser@rossergallery.com`, and grants the displayed send-only permission. A wrong account or a broader returned grant is rejected before persistence. Connecting alone does not create a draft, approve, launch, or send a campaign. Preview, explicit approval, and launch remain separate operator actions.

## Results

- Full unit: 759 tests / 144 files passed (`npm run test:unit -- --maxWorkers=2 --silent`).
- Full smoke: 245 tests / 88 files passed (`npm run test:smoke -- --maxWorkers=2 --silent`). Total: 1,004 tests.
- TypeScript passed (`npx tsc --noEmit`). A pre-existing invalid-fixture assignment was changed to `Object.assign` with the same negative-case assertion, as authorized by the main task.
- Full lint passed with 0 errors and 3 existing callback warnings.
- Production build passed (`npm run build`), with no `.env` files and provider environment variables cleared for the build process. Build ID: `kVCTvC6vg5znJoK9rxBmD`.
- Production-start browser checks passed: 2 Chromium scenarios, desktop 1440×1000 and phone 412×915 (`PLAYWRIGHT_PORT=3080 npx playwright test tests/playwright/warm-reconnect-review.spec.ts --project=chromium --workers=1`, no `PLAYWRIGHT_BASE_URL`). The loopback-only server used five dummy Firebase runtime defaults with no app ID. All CRM APIs were mocked; Firebase/external requests were denied. No unexpected API requests, external requests, or mutations; no horizontal overflow. Separate Gallery sending button and work-connection preservation copy are asserted.
- Local browser artifacts: `playwright-report/index.html`, `test-results/warm-reconnect-review-loca-425d8-e-campaign-visual-and-inert-chromium/workbench-desktop.png`, and `test-results/warm-reconnect-review-loca-dbf1b-e-campaign-visual-and-inert-chromium/workbench-pixel.png`; the report includes full Outreach screenshots.
- Stopped only the owned loopback 3080 production server (verified PID 4112). Frozen 3078 and newsletter 8771 were untouched.
- Redacted Gitleaks scan passed for the tracked diff and this new plan. Full dependency audit passed the high-severity gate: 0 high/critical, 15 moderate findings in unchanged dependencies (production-only audit: 12 moderate). No dependency changes made.
- Independent core review found no remaining actionable issues after the legacy credential preservation guard was added.
- No external changes, provider reads, credentials, scope grants, imports, drafts, or sends performed by this implementation task.
- Worktree is ready for main-task review/fast-forward to tree-identical `origin/main` (`eff63178`); no commit or push performed here.
