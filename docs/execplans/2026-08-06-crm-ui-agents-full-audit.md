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
- [ ] Integrate the responsive desktop/mobile shell and CRM board patch after its final build gate.
- [ ] Integrate the canonical agent/API heartbeat and connector-health protocol patch after review.
- [ ] Run local and production verification gates.
- [ ] Deploy, verify rollback posture, update reports, and email the mobile link.

## Decisions
- Use `codex/crm-full-audit-20260806` at `C:\CTO Projects\agency-os-crm-audit-20260806` to avoid the user’s dirty primary worktree.
- Treat “fully autonomous” as a policy posture, not permission to remove non-bypassable approval gates.
- No existing CRM Figma source was discoverable in the repository, Drive, or Gmail, so use the newly observed audit file rather than inventing a mapping.
- Figma audit file: `https://www.figma.com/design/KNtDTEkNkrwblkGcGUn0wm`; current-product capture node: `2:2`.
- The Figma Starter plan reached its MCP call cap after library/component discovery. Preserve the capture and component inventory; do not claim a completed Code Connect mapping.

## Evidence captured
- Public production URL: `https://leadflow-review.web.app`.
- Desktop cold baseline: HTTP 200; wall 6478 ms; TTFB 3087 ms; DOM content loaded 3570 ms; load 5034 ms; 24 resources; about 343 KB transferred.
- Phone warm baseline: HTTP 200; wall 2406 ms; TTFB 158 ms; DOM content loaded 230 ms; load 437 ms; 27 resources; about 350 KB transferred; no horizontal overflow.
- Baseline lint and smoke suites passed. The first concurrent full-unit run exposed resource-sensitive timeouts that must be rerun serially with explicit evidence.
