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
- [x] Implement daily outcome evidence, status aggregation, alerts, and Mission Control visibility. (Unattended OIDC scheduler wiring remains part of the combined deployment change.)
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
- Deployment impact: deploy the existing Next.js/Cloud Run service after tests. The read route evaluates and transactionally upserts the current receipt when the authenticated CRM loads; a separate OIDC Cloud Scheduler invocation should be added by the scheduler owner for unattended morning/midday/final evaluations. Do not backfill historical days as successful—historical gaps can only be marked `not_observed` with an audit reason.
- Local verification: 23 focused unit/smoke/responsive tests passed; `npx tsc --noEmit` passed; targeted ESLint passed; the Next build emitted `.next/BUILD_ID`, `required-server-files.json`, and both the daily-outcomes API and CRM route bundles. The shell capture timed out while the build workers were finishing, so the generated artifacts—not a captured process exit code—are the available build evidence for this slice.
