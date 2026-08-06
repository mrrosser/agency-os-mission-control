# Mission Control CRM full audit — 2026-08-06

## Scope

Mission Control was reviewed as the shared operator surface for RT Solutions and Rosser Gallery. The audit covered desktop and phone UI, CRM ownership and stage transitions, opportunity-run safety, autonomy policy, agent/API communication, Google Workspace profiles, performance, dependency exposure, Figma evidence, Tailscale/Gmail durability, test coverage, deployment, and rollback.

## Observed production baseline

- Canonical public entry point: `https://leadflow-review.web.app`.
- Desktop cold sample: HTTP 200; 6478 ms wall; 3087 ms TTFB; 3570 ms DOM content loaded; 5034 ms load; 24 resources; about 343 KB transferred.
- Pixel-class phone warm sample: HTTP 200; 2406 ms wall; 158 ms TTFB; 230 ms DOM content loaded; 437 ms load; 27 resources; about 350 KB transferred.
- The public login shell had no horizontal overflow or console error in the recorded desktop/phone samples. The fixed Beta Feedback control occupied too much phone space before the responsive patch.

These samples are diagnostic snapshots, not a statistically complete performance study. The cold desktop TTFB is the primary follow-up metric after deployment.

## Figma/design evidence

- No pre-existing CRM Figma file or node mapping was discoverable in the repository, Google Drive, or Gmail. No mapping was invented.
- Audit file created from the observed product: `https://www.figma.com/design/KNtDTEkNkrwblkGcGUn0wm`.
- Current-product capture: node `2:2`.
- Subscribed libraries observed: Simple Design System and Material 3, plus platform kits.
- Relevant reusable Simple Design System assets were found for Sidebar, Table, Card, Input Field, Dialog, Button, Switch Field, and mobile navigation.
- The Figma Starter plan reached its MCP call cap after capture and component discovery. Code Connect and a rebuilt library-component screen remain explicitly unclaimed.
- A gated `FIGMA_CAPTURE_ENABLED=1` local-only capture hook is retained; production does not set it.

## UI and mobile corrections

- CRM is present in normal navigation.
- The fixed desktop sidebar now has an accessible mobile drawer while preserving the desktop layout.
- The eight-column CRM board retains desktop drag-and-drop and switches to compact phone cards with an accessible stage selector using the same idempotent PATCH route.
- Identity grids, dialogs, and Beta Feedback now fit phone viewports and remain scrollable.
- Dashboard route loading and recovery states are explicit.
- Visible organization naming is normalized to Rosser Gallery.
- Agent Nexus contains separate RT Solutions and Rosser Gallery autonomy controls plus a global execution pause.
- Organization modes are deliberately described as saved policy posture while provider-by-provider enforcement is staged. The global pause is runtime-enforced for new RT Solutions/Rosser Gallery scheduled revenue work, lead workers (including legacy/unscoped jobs), and execution-starting Nexus actions; already in-flight work may finish. Jobs stopped by the pause require an explicit Operations resume after the pause is cleared.

## Safety and incomplete-loop corrections

- CRM writes now verify ownership transactionally. Foreign records fail with 403, ownerless ambiguous records with 409, and missing targets with 404.
- Ownership failures no longer fall through to Firestore projection writes.
- Fallback customer projections preserve business unit, offer, and stage.
- Omitted `draftFirst` resolves to true. The Operations UI now also starts in dry-run and draft-first posture.
- Day 2 and scheduled daily revenue flows cannot disable approval gates.
- Modes are `assist`, `supervised`, and `autonomous_safe`; malformed/unknown policy data resolves fail-closed.
- Email sends, public publishing, SMS, voice calls, spending, payments, contracts, legal decisions, pricing, final submissions, and external calendar creation remain non-bypassable human-approval actions.
- Lead-run creation and worker execution both normalize stale or unsafe configurations back to draft-first, booking-confirmation-required posture with direct SMS, avatar, and outbound-call execution disabled. Live calendar creation is skipped with an approval-required receipt.
- Policy changes use Firebase authentication, operator allowlists, optimistic versions, idempotency, immutable audit history, correlation logs, and trust envelopes.

## Performance and reliability corrections

- Operations no longer launches overlapping five-second job, receipt, telemetry, quota, and alert requests.
- Status polling is serialized at eight-second intervals, pauses in hidden tabs, supports abort on navigation, and refreshes receipts only on a run/status/progress transition.
- Deep telemetry/quota/alert refreshes occur on manual load or terminal transition rather than every poll.
- The dashboard lead fallback listener is bounded at 500 records. At the cap, the primary analytics document is preserved instead of presenting a partial total.
- Firestore listener failures now release the loading state and emit structured client diagnostics with a correlation ID.
- Next.js and eslint-config-next moved from 15.5.12 to 15.5.22; Vitest moved from 3.2.4 to 3.2.6; compatible transitive audit fixes were applied.
- `npm audit` improved from 26 findings (including 2 critical) to 12 total findings in the full dependency tree (0 critical, 4 high, 8 moderate). The production-only resolver reports 13 (0 critical, 4 high, 9 moderate). Remaining reported fixes require major/breaking Next.js, Firebase Admin, or firebase-frameworks changes and were not forced into this production patch.

## Tailscale and Gmail durability

- The Funnel-only reconciler and complete route inventory were reviewed, CI-verified, and admin-merged in AI-Hell-Mary PR 6 at commit `10f51d13305972696b8ead7d36be25be54b8dd57`.
- Live gateway: `https://ai-hell-mary-gateway.tail592a2d.ts.net`.
- Public Gmail triage health returned HTTP 200 and local port 8792 returned `ok` during the audit.
- The live service was healthy, so the newly merged source was not restarted merely to reproduce the already-correct state.

## Agent/API and Google profile status

- Live cadence audit passed with zero mismatches for four consolidated revenue jobs. RT Solutions runs daily at 5:05 AM CT, Rosser Gallery at 5:20 AM CT, AI CoFoundry at 5:35 AM CT, and the cross-organization weekly brain at 6:10 AM CT each Monday.
- All four audited jobs were enabled, used the expected route and America/Chicago timezone, and required approval gates. The daily jobs were bound to the correct `rts`, `rng`, and `aicf` business keys.
- Additional live discovery/coordination jobs were enabled: artist-manager loops every 30 minutes, lead-generation inbox hourly, lead prospecting daily at 6:40 AM CT, Google OAuth health every four hours, and governance watchdog/tick jobs every 15/10 minutes.
- The cadence audit script had still targeted scheduler jobs removed by consolidation. It now verifies the four real jobs, schedules, business keys, safe payload invariants, and authenticated local gcloud configuration.
- The canonical 12-agent registry now uses versioned, organization-scoped heartbeat envelopes and limits external-write capability to the governed action function. MCP probes are timeout-bounded and report observed initialization/tool-list health instead of optimistic placeholders. Legacy four-field heartbeats intentionally fail validation until their producers emit the v1 envelope.
- RT Solutions and Rosser Gallery now use separate Google Workspace profiles (`rt_solutions_work` and `rosser_gallery_work`) with schema-v2 Secret Manager bindings. Connect, callback, and status flows preserve organization/profile context and fail closed on mismatches while retaining legacy no-context compatibility.
- Nexus action starts now fail closed unless the authenticated operator UID appears in the deployment allowlist. The global pause blocks route/resume/wakeup starts, while emergency pause, terminate, and health-style ping remain available.

## Verification and deployment

- Final focused hardening tests: 24 passed; independent review reruns also passed.
- Revenue cadence helper tests: 4 passed; live audit: 4/4 jobs, zero mismatches.
- Responsive CRM unit tests: 6 passed.
- Desktop Chrome and Pixel 7 responsive public-shell Playwright tests: 4 passed.
- TypeScript and touched-file ESLint passed after integration.
- Authenticated desktop/mobile Playwright coverage now signs in through real Firebase Auth and mocks only CRM/autonomy business endpoints; production execution evidence is pending the deployment gate.
- Final local unit gate: 90 files and 340 tests passed. The full smoke suite passed.
- Final production build generated 96 application routes and passed type validation. Post-deploy and production performance evidence remain pending the merge deployment.
- Staged secret scan passed with no leaks. Workflow YAML and the JSON deployment manifest parsed successfully.
- Pre-deploy rollback is preserved in Hosting channel `rollback-crm-audit-20260806` through 2026-08-13; Cloud Run rollback target is the previously serving `ssrleadflowreview-00297-dnx` revision.
- New serving deployment revision: pending merge rollout.
