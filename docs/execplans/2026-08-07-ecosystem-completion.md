# Ecosystem Completion and Daily Outcome Proof

## Goal
- Consolidate the remaining operational gaps behind Mission Control so RT Solutions and Rosser Gallery have one truthful interface for agents, integrations, autonomy posture, and opportunity outcomes.
- Repair the engineering-controlled LeadOps, Paperclip, OpenClaw-sync, and voice MCP paths without weakening approval gates or leaking credentials.
- Prove, rather than promise, whether each organization has at least one meeting booked or one qualified application-ready opportunity on every America/Chicago calendar day.
- Reconcile the feasible Calendar and Figma work, while isolating any OAuth, credit purchase, or plan-upgrade step that only Marcus can authorize.

## Guardrails
- Never commit credentials; use environment variables and Secret Manager references.
- External sends, applications, bookings, publishing, spend, legal commitments, identity-sensitive work, and destructive actions remain approval-gated in every autonomy mode.
- Every service/tool call uses a correlation ID and structured, redacted logs. External creates require deterministic idempotency keys.
- Agent registration, heartbeats, and control-plane sync report state only; they do not execute consequential business actions.
- Existing dirty worktrees and user-owned changes remain untouched. Implementation occurs in this clean worktree from production commit `8c926f6`.
- No provider credits, Figma upgrade, or other purchase is made without explicit authorization.

## Planned scope
- Mission Control agent/control-plane adapters, connector health, organization context, autonomy controls, and outcome UI/API.
- LeadOps and Paperclip service contracts used by Mission Control.
- AI Hell Mary/OpenClaw registration, manifest, voice MCP health, and Tailscale routing contracts.
- RT Solutions and Rosser Gallery revenue/opportunity schedules, receipts, alerts, and daily evidence aggregation.
- Calendar connector status and Figma source/library reconciliation that is possible on the current accounts.
- Unit, smoke, contract, desktop/mobile, security, production, rollback, and deployment documentation.

## Definition of done
- LeadOps, Paperclip, OpenClaw sync, and voice MCP statuses are either operational with passing probes or truthfully blocked with a precise operator action; no false-green state remains.
- Mission Control shows per-organization connector ownership and the last successful registration/heartbeat/probe with correlation evidence.
- Each local day and organization has a deterministic outcome record with one of: `met`, `at_risk`, `missed`, or `not_observed`; `met` requires a meeting receipt or a qualified application-ready opportunity receipt.
- Opportunity evidence includes organization, source, deadline/time, qualification reasons, next action, owner, approval state, and immutable receipt/source references. Discovery alone cannot satisfy the target.
- Safe research/drafting may run in `autonomous` posture, while protected actions remain non-bypassable and auditable.
- Calendar and Figma are re-verified. Any unavoidable OAuth, billing, credit, or plan limit is surfaced as a single exact action rather than described as completed.
- Lint, typecheck, unit, smoke, build, dependency, secret, and relevant desktop/mobile gates pass, with mocked external APIs in tests.
- Deployment and rollback instructions are current, production is re-smoked, and the final report distinguishes completed engineering work from user-authorized follow-ups.

## Progress
- [x] Created a clean implementation worktree and branch from the verified production commit.
- [x] Loaded the automation control-plane, approval lifecycle, mission-control sync, growth outcome, GCP MCP, Google Calendar, and Figma operating contracts.
- [ ] Complete current-state and root-cause inventory across all named integrations.
- [ ] Implement connector/OpenClaw/voice repairs that do not require new financial or OAuth authorization.
- [x] Implement daily outcome evidence, status aggregation, alerts, Mission Control visibility, and unattended OIDC scheduler wiring.
- [ ] Reconcile Calendar and Figma within current account limits.
- [ ] Run local and production gates, deploy through reviewed CI, and publish final evidence.

## Decisions
- Treat “one opportunity every day” as a measurable service-level objective, not a fabricated guarantee. A day is successful only when durable evidence meets the receipt contract.
- Keep the two organizations isolated by canonical organization ID and profile binding; global aggregation cannot substitute for per-organization readiness.
- Preserve the existing global pause and protected-action list. Organization autonomy modes control eligible low-risk work only.
- Prefer repair or truthful degradation over adding duplicate agents. A new agent/sub-agent is added only when an existing ownership boundary cannot safely perform the job.
- Use the current Figma Starter plan as a hard limit unless Marcus explicitly approves an upgrade; code-side design-token reconciliation remains available without a purchase.
- Provider-credit exhaustion is an external financial blocker. Engineering may add health, failover, and operator guidance, but must not purchase credits or silently redirect to an unapproved provider.

## Verification and deployment
- Local: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, `npm run test:smoke`, and `npm run build`.
- Targeted connector and outcome contract tests run before the full suite; external APIs are mocked.
- Browser: authenticated desktop Chrome and Pixel-class mobile coverage for Agent Nexus, Integrations, CRM, and the daily outcome surface.
- Security: `npm audit --audit-level=high` and staged `gitleaks` scan; document non-breaking exceptions.
- Deployment: push the feature branch, open a reviewed pull request, require CI/prompt evaluations/preview success, merge, and monitor the candidate-first Firebase Hosting + Cloud Run promotion workflow.
- Rollback: retain the previously verified ready Cloud Run revision and live Hosting version until post-deploy public/authenticated probes and exact rewrite/tag checks pass.

## Findings and evidence
- Pending. Update this section as each root cause is reproduced and each fix is verified.

### Daily outcome proof
- Live Rosser evidence at audit time: workspace `ws_cd43331c4b1648d0` had 27 `artist_manager_opportunities`; the latest cycle ingested 18, created 7 research artifacts, refreshed 27, and executed 0. Six scored at least 80, but all 27 had non-empty `missingRequirementKeys`, so the truthful application-ready count was zero. The artist-manager root profile/settings/assets collections also had no documents.
- Live RT evidence at audit time: workspace `ws_ee1735c095774325` was absent from the artist-manager scheduler and source binding. It must remain `not_observed` instead of inheriting Rosser evidence or treating generic lead discovery as an RT opportunity.
- The daily proof implementation uses fixed workspace/business identity mappings, `America/Chicago` local dates, deterministic outcome IDs/idempotency keys, server-only Firestore reads/writes, correlation logs, and public response projections that omit workspace, entity, provider, attendee, and account identifiers.
- `met` requires either (a) a real confirmed future provider event, at least one accepted external attendee, a current source receipt, and a booking/acceptance timestamp from the current local day; or (b) an explicitly ready opportunity with public URL, fit score at least 80, verified and complete requirements, no exclusions, a parseable future deadline or explicit rolling/open state, and a current content-hashed source receipt. RT opportunities additionally require a `paid_signal` tag, positive structured compensation, or unambiguous compensation text.
- Unknown/expired deadlines, incomplete matches, stale/missing receipts, booking links, CRM booking stages, simulations, and discovery-only records fail closed. Before the final cutoff a current rejected candidate yields `at_risk`; after the cutoff it yields `missed`; no current observation yields `not_observed`.
- New server collection: `mission_control_daily_outcomes/{deterministicOutcomeId}`. No legacy data rewrite is required. Current-day reads use deterministic IDs; the evaluator's workspace equality queries use automatic single-field indexes. If a history view is added later, add a composite index for `workspaceId`, `businessUnit`, and descending `localDate`.
- Deployment impact: deploy the existing Next.js/Cloud Run service after tests. The authenticated CRM read route still evaluates and transactionally upserts the current receipt. The consolidated daily worker now evaluates both organizations after each successful automation run, and the outcome-only worker supports idempotent morning (`05:50`), midday (`12:00`), and final (`20:05`) America/Chicago evaluations. Do not backfill historical days as successful—historical gaps can only be marked `not_observed` with an audit reason.
- Local verification: 23 focused unit/smoke/responsive tests passed; `npx tsc --noEmit` passed; targeted ESLint passed; the Next build emitted `.next/BUILD_ID`, `required-server-files.json`, and both the daily-outcomes API and CRM route bundles. The shell capture timed out while the build workers were finishing, so the generated artifacts—not a captured process exit code—are the available build evidence for this slice.

### Revenue worker OIDC and unattended outcome cutover
- The steady-state worker contract is Google OIDC only. `REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL` must be the exact dedicated `revenue-automation-scheduler@${GCP_PROJECT_ID}.iam.gserviceaccount.com` identity, and `REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE` must exactly equal the HTTPS Cloud Run service origin. Tokens with the wrong issuer, audience, service-account email, verification state, or subject fail closed.
- The worker identity is server-configured with `REVENUE_AUTOMATION_UID`; caller-provided UIDs are optional compatibility assertions and are rejected if they differ. Before evaluation, the worker must have an `active` membership document in both fixed daily-outcome workspaces. An owner-UID shortcut cannot bypass this worker check. Missing membership or incomplete two-organization output returns a retryable service error instead of a false success.
- The existing consolidated daily and weekly jobs, POS loop, and three outcome checkpoints all use Cloud Scheduler OIDC. The legacy Day 1/Day 2 endpoints and the GitHub weekly KPI job use the same verifier. Scheduler bodies no longer contain a UID, and setup never reads or writes a worker token. Final verification inventories every `revenue-*` job and fails if an `Authorization` header or any historical automation/Day 1/Day 2/Day 30/POS/weekly-KPI token header remains.
- A verified `met` receipt is monotonic for its local day: a later source outage cannot erase the earlier proof. The latest degraded source health remains visible and is persisted before unattended workers return a retryable `503`.

Local verification:
```powershell
npx vitest run tests/unit/revenue-worker-auth.test.ts tests/unit/revenue-daily-outcome-worker.test.ts tests/unit/revenue-automation-scheduler-script.test.ts tests/smoke/revenue-automation-daily-worker-task-route.test.ts tests/smoke/revenue-day30-worker-task-route.test.ts tests/smoke/revenue-daily-outcomes-worker-task-route.test.ts
npx tsc --noEmit
npx eslint lib/revenue/worker-auth.ts lib/revenue/daily-outcome-worker.ts app/api/revenue/automation/daily/worker-task/route.ts app/api/revenue/day30/worker-task/route.ts app/api/revenue/daily-outcomes/worker-task/route.ts
```

Deployment and canary (phase 1):
1. Confirm the configured `REVENUE_AUTOMATION_UID` has `active` membership in both canonical workspaces. Do not substitute an owner bypass.
2. Before merging, store that UID only in the `REVENUE_AUTOMATION_UID` GitHub repository secret and set the `REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN` repository variable to `true`. The production workflow derives the exact project-scoped scheduler service account and OIDC audience from Cloud Run `status.url`, rejects conflicting optional repository-variable overrides, and creates a 900-second candidate revision. Keep the existing legacy token secret mappings only for this bounded compatibility window.
3. Set `GCP_PROJECT_ID`, `GCP_SCHEDULER_LOCATION`, `REVENUE_AUTOMATION_CLOUD_RUN_SERVICE`, `REVENUE_AUTOMATION_CLOUD_RUN_REGION`, and the exact `REVENUE_AUTOMATION_SERVICE_URL` in the operator shell. No secret value is required by the setup script.
4. Grant the operator `roles/iam.serviceAccountTokenCreator` temporarily on only the dedicated Scheduler service account, then run `powershell -ExecutionPolicy Bypass -File .\scripts\revenue-automation-scheduler-setup.ps1 -CutoverPhase Canary -RunOidcCanary`. The setup idempotently creates/checks the service account, grants only `roles/run.invoker` on the named service, requests an email-bearing outcome-only OIDC canary without printing the identity token, writes a sanitized rollback manifest plus executable pause script, and only then replaces canonical job auth with OIDC and re-describes each job. Revoke the temporary Token Creator binding immediately after this canary.
5. Confirm Cloud Scheduler attempt status and Cloud Run structured logs by correlation ID. Keep external sends/applications approval-gated; this canary only reads evidence and upserts deterministic outcome receipts.

Final cutover (phase 2):
1. Set the `REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN` repository variable to `false` and deploy a second reviewed revision. Do not remove the variable because the safe default is phase-1 `true`. The production workflow removes both value-backed and Secret Manager-backed mappings for the automation, Day 1, Day 2, Day 30, POS, and weekly-KPI static tokens, then proves all six names are absent before the candidate can be promoted.
   After the exact Firebase Hosting rewrite is live, the workflow also removes every historical Cloud Run traffic tag except the current sanitized release tag and verifies that no other tagged revision remains publicly addressable.
2. Run `powershell -ExecutionPolicy Bypass -File .\scripts\revenue-automation-scheduler-setup.ps1 -CutoverPhase Finalize -RunOidcCanary`. Finalize re-verifies every canonical OIDC contract, deletes only the exact legacy revenue-job allowlist, and rejects any remaining static revenue authentication header.
3. Inventory Cloud Run, Cloud Scheduler, and GitHub Actions for each of the six legacy secret names. Only after the inventory is empty, disable the corresponding Secret Manager versions and record their version identifiers as the recoverable emergency rollback receipt; never delete secret versions during the cutover.
3. Run the same script with `-CutoverPhase Verify` for a read-only reconciliation. Verify the current local-day records exist for both organizations and that morning/midday/final jobs use America/Chicago.

Rollback:
- Before phase 2, leave `REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN=true`. The sanitized rollback bundle under `artifacts/revenue-scheduler-rollback/` records prior schedules without credential values and includes `pause-managed-jobs.ps1`; use it to stop the OIDC cadence while a corrected OIDC revision is deployed. It deliberately cannot restore bearer headers.
- After phase 2, prefer rolling the application back while keeping OIDC enabled. If OIDC itself is the fault, pause the managed jobs and deploy a corrected signed-identity revision. Restoring a static token is an explicitly time-bounded incident exception, not the generated rollback path. Never paste a token into a command, terminal transcript, issue, or document.
- The setup stops without guessing when the project, Cloud Run service, service origin, IAM `actAs`/Token Creator permission, runtime OIDC env, or either active workspace membership is missing. Those are operator/account blockers, not values to infer in code.
