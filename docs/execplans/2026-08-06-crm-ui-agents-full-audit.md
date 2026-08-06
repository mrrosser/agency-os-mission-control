# CRM UI, Agent, and Autonomy Audit

## Goal
- Make Mission Control dependable for daily use on desktop and mobile across RT Solutions and Rosser Gallery.
- Reconcile the implemented interface with the verified Figma/design-system source, improve perceived and measured load performance, and close incomplete operator loops.
- Make organization, agent, and automation communication visible and testable through the existing API/tool protocol.
- Expose clear semi-autonomous and fully autonomous posture controls without bypassing spend, legal, identity, external-send, scheduling, or publish approval gates.

## Guardrails
- No secrets in source control; use environment or Secret Manager references.
- Consequential actions require the existing execution envelope, runtime run/correlation IDs, idempotency, and evidence.
- “Fully autonomous” means eligible low-risk work may execute automatically. High-risk or externally consequential work remains fail-closed behind the policy gates already defined by the control plane.
- Browser/OAuth verification runs in the dedicated Playwright lane. Production does not receive a dev-login bypass.
- Changes stay small, reversible, and covered by unit, smoke, and UI tests.

## Planned scope
- Dashboard shell and primary pages under `app/dashboard/`.
- Shared UI, navigation, organization context, loading/error states, and responsive behavior under `components/`.
- Agent/control-plane, customer-memory, Google Workspace, revenue, social, and automation contracts under `app/api/` and `lib/`.
- Playwright desktop/mobile coverage under `tests/playwright/` and the dedicated `C:\CTO Projects\ui-tests` lane.
- Run/deploy documentation and evidence under `docs/`.

## Definition of done
- Primary authenticated CRM flows have repeatable desktop and phone coverage using the real application surface with external APIs mocked where required.
- The live login/mobile entry point is usable, accessible, responsive, and has no known blocker in the audited paths.
- Design tokens and reusable components are reconciled with an observed Figma/design-library source or the absence of that source is explicitly documented without inventing a mapping.
- Loading, retry, empty, error, and success states are explicit; no audited polling loop leaks, duplicates work, or hides failure.
- RT Solutions and Rosser Gallery are selectable and visibly bound to the correct profiles, agents, and automation policy.
- Autonomy posture is configurable per organization and capability, while protected actions remain approval-gated and auditable.
- Agent/API communication health is summarized in the UI and verified through deterministic contract tests.
- Lint, unit, smoke, Playwright desktop/mobile, build, dependency, secret, and production health gates pass or have an evidence-backed non-regression exception.
- Deployment and rollback instructions are current, the production mobile URL is re-verified, and Marcus receives that observed URL by email.

## Status
- [x] Created a clean branch from the verified production commit.
- [x] Validated the repo computer-environment manifest.
- [x] Completed UI, integration, Figma-source, and Tailscale durability inventories.
- [x] Merged the reviewed Tailscale Funnel/Gmail durability fix after CI passed; the healthy live gateway did not require a restart.
- [x] Captured current desktop/mobile baselines and measured cold/warm performance.
- [x] Created the observed Figma audit file, captured the current product, and inventoried its subscribed Simple Design System and Material 3 libraries.
- [x] Implemented fail-closed CRM ownership, draft-first, and approval-gate corrections.
- [x] Implemented versioned RT Solutions/Rosser Gallery autonomy policy controls and non-bypassable protected actions.
- [x] Serialized Operations polling, stopped hidden-tab polling, and limited deep receipt/telemetry refreshes to progress transitions.
- [x] Integrated the responsive desktop/mobile shell and CRM board patch.
- [x] Integrated the canonical agent/API heartbeat and connector-health protocol patch.
- [x] Added separate RT Solutions and Rosser Gallery Google Workspace profiles with fail-closed context checks.
- [x] Routed immediate and queued follow-up processing through the lead run's organization-bound Google profile, while preserving explicit AICF/legacy behavior.
- [x] Changed caught Day 2 response-loop errors, failed drafts, and skipped drains from false-green HTTP 200 completion into visible 502 failures with structured diagnostics; Day 30 completes its independent work before surfacing the failure.
- [x] Added an exact, bounded revenue Scheduler policy (three retries, 60-300 second backoff, two doublings, no duration override) plus drift detection for all four consolidated jobs.
- [x] Connected the global execution pause to new RT Solutions/Rosser Gallery revenue work, lead workers, and execution-starting Nexus actions.
- [x] Forced lead-run protected actions into draft/approval posture at creation and again at worker execution.
- [x] Added credential-gated authenticated desktop and Pixel-class CRM Playwright coverage without a production auth bypass.
- [x] Run final local verification gates, dependency audit, and staged secret scan.
- [x] Audited the live OpenClaw CPU alert, disabled unfunded model heartbeats, removed a stale plugin declaration, restarted cleanly, and re-verified Tailscale/Gmail health.
- [ ] Run production health, authenticated desktop/phone, performance, and cadence gates.
- [ ] Deploy, verify rollback posture, update reports, and email the mobile link.

## Decisions
- Use `codex/crm-full-audit-20260806` at `C:\CTO Projects\agency-os-crm-audit-20260806` to avoid the user’s dirty primary worktree.
- Treat “fully autonomous” as a policy posture, not permission to remove non-bypassable approval gates.
- No existing CRM Figma source was discoverable in the repository, Drive, or Gmail, so use the newly observed audit file rather than inventing a mapping.
- Figma audit file: `https://www.figma.com/design/KNtDTEkNkrwblkGcGUn0wm`; current-product capture node: `2:2`.
- The Figma Starter plan reached its MCP call cap after library/component discovery. Preserve the capture and component inventory; do not claim a completed Code Connect mapping.
- Organization modes are saved, audited policy posture in this increment. The global pause has runtime enforcement; provider-by-provider organization-mode enforcement remains staged so existing `assist` defaults do not silently stop approved schedules.
- Protected external actions remain approval-gated in every posture. Lead-run configuration is normalized at both the create boundary and worker boundary so stale unsafe jobs fail into the safe posture.
- Legacy/unscoped lead jobs consult the global pause fail-closed. Clearing the pause allows new work, but jobs already stopped by it require an explicit Operations resume.
- PR preview and merge deployments share one non-cancelling, FIFO-style queued concurrency group because both update the same Cloud Run SSR service.
- The follow-up response loop resolves Google profile context centrally from the lead-run job so Day 2, the authenticated worker, and later Cloud Tasks drains cannot diverge.
- Day 2 response-loop errors, terminal draft-task failures, and an undeliverable next drain are not best-effort successes. Draft tasks are requeued with bounded exponential backoff for up to three processing attempts before becoming terminal. Direct Day 2 returns 502; Day 30 first persists its independent KPI/memory/closer/digest work and then returns 502. Cloud Scheduler is configured for exactly three retries with 60-300 second backoff, two doublings, and no maximum-retry-duration override, so provider failures retry predictably without an unbounded loop.
- Agent pause/resume/terminate/wakeup actions use the Paperclip lifecycle adapter. Ping and route currently have no execution adapter and now fail visibly with 503 instead of writing an unconsumed queue record.
- OpenClaw model heartbeats remain disabled until at least one configured model provider has usable credits. Revenue/CRM schedulers remain independent; no claim of full model autonomy is valid while both providers reject usage.

## Evidence captured
- Public production URL: `https://leadflow-review.web.app`.
- Desktop cold baseline: HTTP 200; wall 6478 ms; TTFB 3087 ms; DOM content loaded 3570 ms; load 5034 ms; 24 resources; about 343 KB transferred.
- Phone warm baseline: HTTP 200; wall 2406 ms; TTFB 158 ms; DOM content loaded 230 ms; load 437 ms; 27 resources; about 350 KB transferred; no horizontal overflow.
- Baseline lint and smoke suites passed. The first concurrent full-unit run exposed resource-sensitive timeouts that must be rerun serially with explicit evidence.
- Final local gates after response-boundary and retry hardening: lint passed; TypeScript passed; 94 unit files/365 tests passed in the deterministic single-worker run; full smoke passed; responsive desktop/phone browser tests passed 4/4; production build passed with 96 routes.
- The earlier concurrent 92-file unit run hit the previously observed resource-sensitive five-second timeout in `api-secrets-fallback`; that file passed 3/3 in isolation. After the final additions, the complete 94-file single-worker suite passed 365/365.
- Dependency audit: full tree 12 findings (0 critical, 4 high, 8 moderate); production-only resolver 13 findings (0 critical, 4 high, 9 moderate). Remaining fixes require breaking major upgrades.
- Pre-deploy rollback channel `rollback-crm-audit-20260806` preserves the previously serving Hosting state through 2026-08-13. Cloud Run rollback target remains `ssrleadflowreview-00297-dnx` until post-deploy verification completes.
- Staged `gitleaks` scan passed with no leaks.
- The 2026-08-06 RT Solutions, Rosser Gallery, and AICF scheduler requests all reached Cloud Run at their expected times and returned HTTP 200 on the old revision. Structured logs exposed `oauth.no_tokens` and `revenue.day2.response_loop_failed` inside the RT run, proving the old response was only partially successful.
- Focused organization-profile, draft-recovery, Day 2/Day 30 response boundary, Scheduler retry, HTTP fallback, and agent-action regression coverage passed 43/43 across seven files. RT/RTS select `rt_solutions_work`, Rosser selects `rosser_gallery_work`, historical tasks can supply missing organization context, truly context-free historical work preserves the legacy path, non-empty unsupported or contradictory context fails closed, and incomplete response work throws 502 only after Day 30 persists independent outputs.
- The enhanced cadence audit correctly reports retry drift on all four live jobs because production still has the old zero-retry defaults. Applying the bounded retry policy is a required post-deploy step before the cadence gate can pass.
- The OpenClaw gateway CPU alert was traced to hourly heartbeats retrying two unfunded model providers. After backing up the runtime config, setting the heartbeat interval to `0m`, removing an unavailable plugin declaration, and restarting, the service reported heartbeats disabled, settled near 0-1% CPU, and retained HTTP 200 Gmail triage health through Tailscale.
- GitHub Actions remains under an official major incident. Required runs on the latest pushed head were cancelled with zero executed steps, so protected merge/deployment remains pending a fresh green run after recovery; no admin bypass is being used during the outage.

## Local verification and deployment
- Install and verify locally with `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run test:smoke`, and `npm run build`.
- Run responsive browser coverage with `npx playwright test tests/playwright/responsive-shell.spec.ts --project=chromium --project=mobile-chrome`.
- Authenticated CRM coverage requires temporary `PLAYWRIGHT_TEST_EMAIL` and `PLAYWRIGHT_TEST_PASSWORD` environment variables plus `PLAYWRIGHT_BASE_URL`; no credential is committed or logged.
- Production deploys through `.github/workflows/firebase-hosting-merge.yml` after reviewed merge to the default branch. Monitor Firebase App Hosting/Cloud Run and keep the previously active ready revision as the rollback target until post-deploy verification passes.
