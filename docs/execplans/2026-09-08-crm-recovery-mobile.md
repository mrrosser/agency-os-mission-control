# CRM recovery and mobile workbench

Correlation ID: `crm-review-recovery-20260908`.

## Outcome

Recover the user-reported production white screen, replace the long stacked CRM page with focused workspaces and quick actions, and add first-party share-card candidates using already-live intake destinations. Keep authentication, permission and send controls intact.

## Source and authority

- Isolated branch `codex/crm-recovery-mobile-20260908` from `36f5d2fc2e3b11598fcde9e41b6066be17361385`.
- The September 1 source worktree's layout chunk matches the failing production layout chunk by filename and SHA-256. The canonical checkout is dirty and was not edited.
- User requested the fix, mobile overhaul and branded intake sharing. Work is local candidate implementation and verification; no production release, sends, pilot launch, contact import or provider configuration mutation has occurred.
- Newsletter editing desk is separate at `C:\CTO Projects\RNG_Artist_Projects\output\newsletter-review-2026-09-08\`, localhost 8771.

### Live-release approval update

Marcus subsequently approved publishing this repair/redesign **with email sending capability enabled**. This authorizes release preparation and capability configuration, not a newsletter, reconnect pilot or actual recipient send. Durable decision: `docs/execplans/2026-09-08-crm-release-approval.json`.

Fresh checks confirm `main` remains `4d3413f`; the two production-matching baseline commits remain local-only. Preserve them in the release PR. Required GitHub protection is one approving review plus strict/up-to-date `test` and `build_and_preview`, enforced for admins; chat approval does not bypass this gate.

Fresh email checks found zero warm pilot documents and no warm-reconnect scheduler jobs; the live send flag remains absent/off. The exact Gallery binding resolves through Google to `mrosser@rossergallery.com`, not the currently required OAuth identity `mrosser@rossernftgallery.com`. No sender-alias lookup or send followed that mismatch. User reconciliation is requested. The existing broader OAuth grant also fails the dedicated send-only scope check; do not weaken that check or silently use personal credentials.

The existing CRM send-only connect button replaces that Gallery profile's broader grant; it is not an independent credential. This could remove current Drive/Calendar and Gmail-reading access. Capability approval does not authorize this loss. Preserve those integrations with a reviewed separate sending connection or obtain explicit approval for replacement; do not reconnect silently.

Release-specific fixes remove preview-only labels and isolate public share-action props/modules from private intake-readiness notes. The production workflow preserves the five already-live Second Brain Secret Manager references without reading or rotating their values. Final review found the old shared-service preview path did not prove its public URL targeted the corrected runtime, so PR cloud deployments are removed, not merely send-disabled. Required PR tests/build remain; no preview URL is published. Production capability is controlled through a strict validated repository variable with false default; it must remain unchanged until the sender preflight is resolved.

## Implementation

- [x] Reproduce missing Firebase public-config crash before login.
- [x] Repair configuration precedence and public-variable bundling; add standalone recovery UI.
- [x] Preserve runtime defaults and prevent incomplete runtime config from reporting a successful response.
- [x] Replace stacked CRM with People / Outreach / Share cards / Activity workspaces.
- [x] One-click add-contact dialog, outreach navigation and share navigation; keyboard tab controls.
- [x] Search and business filters apply to mobile list and desktop board consistently.
- [x] Jump from a contact to its activity with keyboard focus; do not change server-side stage/action authority.
- [x] Use existing AfroGlyph brand symbols, warm ivory/plum styling, 44px-plus quick actions and reduced-motion behavior.
- [x] Add two share cards, static vCards and independently decoded offline QR PNGs for current live destinations.
- [x] Finish integrated unit/smoke, production-build and browser checks.
- [x] Record publication/capability approval, excluding actual sends.
- [ ] Resolve Gallery identity/send-only OAuth preflight and required GitHub review/checks before changing live hosting.

## Scope guardrails

Registry people, loaded editable pipeline contacts, opted-in contact points and final newsletter recipients are different counts. Do not label them interchangeably. Unknown data displays a dash/readiness unavailable, not zero or a ready status. Existing warm-reconnect source has a held posture; the UI must not invent a ready-to-send state.

Navigation and search do not write records or change permissions. Existing mutation endpoints and approval gates remain the authority. Adding a pipeline contact does not enroll them in marketing.

The share QR codes open `https://rossergallery.com/qr` and `https://rt.solutions/contact`. New `/connect/rosser-gallery` and `/connect/rt-solutions` pages are local release candidates, not yet live replacements. Public pages expose only public business details, contact downloads and links; never canonical CRM people, private tokens or operator controls.

Gallery submission-to-CRM receipts need verification. RT's automatic CRM bridge is not built. Gallery's existing private receiver can queue acknowledgments, so it must not be reused as a silent CRM-only endpoint without reviewing that behavior. QR scanning/contact saving is not a form submission or newsletter opt-in. No business-card photographs were ingested in this work.

## Local run and verification

Use the existing pinned Node 22/package-lock dependency tree. The candidate uses a local node_modules junction to the matching September 1 source dependency tree; no package changes were made.

Run focused tests with `node node_modules/vitest/vitest.mjs run tests/unit/crm-workbench.test.tsx tests/unit/share-cards.test.tsx tests/unit/firebase-client-config.test.ts`. Full checks: `npm.cmd run lint`, `npm.cmd run test:unit -- --maxWorkers=2`, `npm.cmd run test:smoke -- --maxWorkers=2`, and `npm run build`.

For local-only mocked interaction checks use `PLAYWRIGHT_PORT=3078` and `node node_modules/@playwright/test/cli.js test tests/playwright/warm-reconnect-review.spec.ts --project=chromium --workers=1`. This fixture refuses deployed-service targets and mocks provider actions. Never run its seeded local Firebase identity against production.

The final browser run reused the loopback production server on 3078 with dummy five-field runtime defaults, not Next dev. Its API key is the non-secret fixture string `playwright-local-api-key`; the other public dummy fields match `playwright.config.ts`, with appId omitted. `PLAYWRIGHT_BASE_URL` was unset, letting the existing server be reused. This does not provide access to real CRM data and is not a production sign-in environment.

The recovery regression builds without NEXT_PUBLIC variables then starts with non-secret dummy `__FIREBASE_DEFAULTS__`, matching production's configuration shape without using real accounts. Use `scripts/firebase-bootstrap-smoke.mjs` for complete/missing-config paths.

## Deployment

Use the reviewed PR-to-main pipeline in `.github/workflows/firebase-hosting-merge.yml`, not the bare `npm run deploy:firebase` wrapper, which defaults to direct live hosting deployment. The pipeline coordinates an isolated SSR candidate, runtime smoke, traffic promotion, Hosting rewrite tags, exact version proof and live channel clone. Its postdeploy smoke is write-bearing (synthetic identity/lead/template/run job plus attempted cleanup), not a read-only test. Review that behavior as part of the release.

Before release, refresh remote ancestry: cached main `4d3413f` is behind the production-matching base by commits `a251df2` and `36f5d2f`. Do not silently drop or include those antecedents without reviewing the exact release diff. CI still requires its six public Firebase env values, WIF and runtime configuration even though the runtime fallback now accepts the deployed five-field Auth/Firestore shape. Never print secret values.

Root force-dynamic changes rendering/cache behavior across the application. Landing, preferences, login, dashboard boundary and public cards have been production-start smoke-tested, but production load/cost effects are not measured. Do not deploy from the old dirty canonical checkout or enable dev-login in production. The later capability approval does not remove the sender preflight or campaign approval gates.

Capture fresh rollback identifiers for both Cloud Run revision/rewrite tag and Firebase Hosting version. The August rollback channel in `docs/deploy-manifest.json` is expired; its old commands are not valid evidence for this release. A traffic-only rollback is insufficient when Hosting pins a tag. No production deployment is needed for the separate localhost newsletter desk.

## Final local verification, September 8

- Full lint: pass, zero errors, three pre-existing unused-variable warnings in unchanged Google callback files.
- Full unit suite: 143 files / 716 tests passed; full smoke: 88 files / 245 tests passed. External clients and stores mocked.
- Production build and typecheck: pass, without build-time Firebase config; no package changes.
- Recovery browser checks: eight scenarios covering valid runtime defaults, readable missing-config recovery and both public cards, at desktop/mobile widths.
- Broader rendering: six scenarios covering landing, no-token preferences and logged-out dashboard at both widths. No page errors or horizontal overflow.
- Mocked CRM browser suite: two tests pass on the production artifact, covering modal focus return, search, brand filtering, excluded-contact/activity clearing, workspace actions and unchanged send gates. No unexpected writes or external requests. An expanded test initially timed out on an overly exact label selector; correcting the test to use the stable field ID passed both scenarios without changing application code.
- Both QR PNGs independently decoded to the stated live targets.
- `npm audit --audit-level=high`: exit 0, no high/critical findings; 13 moderate findings remain in the unchanged dependency tree. No automatic fixes or upgrades applied.
- Redacted Gitleaks scan: no leaks in tracked changes or 21 new text files. Diff whitespace check passed; Git emits existing LF/CRLF conversion warnings.
- Independent code review confirmed the three navigation/readiness/focus fixes; no new blocking finding in that reviewed scope.

Evidence: `C:\CTO Projects\RNG_Artist_Projects\output\crm-sept8-diagnostics\DIAGNOSIS.md`, its screenshots/scripts, and candidate `test-results/` / `playwright-report/`. Local-only implementation complete for recovery, workbench and share-card candidates. Public deployment and verified end-to-end intake remain incomplete.

## Fresh release-candidate verification after follow-up fixes

- Full unit suite: 144 files / 737 tests passed. Full smoke suite: 88 files / 245 tests passed. Total 982 tests; all external stores/providers mocked.
- Full lint: exit 0, zero errors, the same three unused-variable warnings in unchanged Google callback code/tests.
- Production build/typecheck: exit 0, all 91 pages generated, without build-time Firebase config or package changes.
- Fresh production-start browser checks: eight bootstrap/public-card scenarios, six landing/preferences/dashboard boundary scenarios, two mocked desktop/mobile CRM workflows. All 16 passed. Valid five-field runtime defaults reach login; missing config has readable recovery; public cards still render without private providers.
- Visually reviewed fresh desktop/mobile workbench and mobile Gallery card screenshots. No horizontal overflow or unexpected page errors in tested scenarios.
- Release privacy suite: 12 tests pass, including allowlisted client props and public import-graph isolation. Runtime/workflow suite: 28 tests pass; two YAML files parse and 24 Bash blocks pass syntax checks. Included in the full suite above.
- Fresh redacted Gitleaks scan: no leaks in the aggregate tracked diff from main or all 28 new text files. Whitespace check passed; only existing LF/CRLF conversion warnings remain.
- Evidence: sibling RNG `output/crm-sept8-diagnostics/release-browser/`, broad-render screenshots and this candidate's `test-results/`.
- Release remains held for GitHub review/checks plus exact Gallery account and send-only scope reconciliation. No production release, capability change, email, import, or campaign launch occurred during these checks.

### Final shared-preview hold

The follow-up only changes the PR workflow, workflow assertions and release notes. It removes cloud authentication, Hosting/runtime mutations and write permissions from the PR job. The required `build_and_preview` job still runs npm tests and build and reports that no preview URL was published. Production workflow and application artifact are unchanged. Existing remote preview channels were not changed or treated as safe evidence.

Final scoped workflow/runtime checks: 26 tests pass; ESLint, YAML parsing, all six revised PR Bash blocks and whitespace checks pass. The prior 28-test result above describes the superseded preview-runtime approach, not the final policy.

Final full unit rerun: 144 files / 735 tests passed (367.81 seconds). The two fewer assertions correspond to removed preview deployment behavior, replaced by a no-cloud-deployment assertion; no application tests were removed. Combined with the unchanged 245 passing smoke tests, final suite coverage is 980 tests. Separate executor checks with process capability=true passed 16 unit and four route smoke tests with provider mocks. Final aggregate-diff Gitleaks scan from main found no leaks, including the now-tracked QR generation source.
