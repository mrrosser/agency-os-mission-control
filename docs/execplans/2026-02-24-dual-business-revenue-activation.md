# ExecPlan: Dual-Business Revenue Activation (30-Day)

Date: 2026-02-24  
Owner: Mission Control + OpenClaw Runtime  
Status: In Progress

## Goal

Turn Mission Control + OpenClaw into a deterministic revenue engine for:

1. Rosser NFT Gallery (gallery + events + preservation)
2. RT Solutions (web + AI education + custom builds)

## Business Outcomes (by 2026-03-26)

- Publish packaged offers with deposit/pre-order flows in Square.
- Run deterministic Source -> Enrich -> Score -> Outreach -> Booking loops for both businesses.
- Track weekly pipeline/revenue metrics in one source of truth.
- Keep outbound/payment/booking side effects approval-gated and idempotent.

## Scope

- Operating model and boundary decisions.
- Offer packaging, deposit rules, and intake requirements.
- Stage-worker execution plan and weekly KPI loop.
- Cross-repo handoff contract (`agency-os-mission-control` <-> `AI_HELL_MARY` <-> SMAuto).

## Current Implementation Snapshot (2026-02-24)

- Control-plane boundaries are in place: Mission Control remains orchestration + approvals, OpenClaw/AI_HELL_MARY remains runtime, SMAuto remains external tool surface.
- Revenue activation backend foundations are in place:
  - Day-1 automation routes (`/api/revenue/day1`, `/api/revenue/day1/worker-task`)
  - Square deposit webhook with idempotent replay guard (`/api/webhooks/square`)
  - Weekly KPI rollup routes + scheduled worker path (`/api/revenue/kpi/weekly*`)
- Cross-repo artifact sync is in place via `scripts/sync-ai-hell-mary.mjs` (nightly Windows task helper included).
- Remaining business-critical work is executional:
  - publish final Square catalog offers,
  - wire finalized intake/booking links,
  - run KPI loop against live deal flow and operationalize weekly scale/kill decisions.

## Out of Scope

- New backend architecture rewrite.
- Removing current idempotent API route safety.
- Auto-send outbound with no approval policy.

## Plan (1-5)

### 1) Lock system boundaries (hard requirement)
- [x] `agency-os-mission-control` remains control plane, lead runs, scoring, and operator approvals.
- [x] `AI_HELL_MARY` remains runtime execution, channel handling, and business knowledge packs.
- [x] SMAuto remains external social execution tool.
- [x] Define single CRM source-of-truth ledger and stage schema (no dual-write).
  - Evidence:
    - Boundary and runtime contracts documented in `docs/runtime-capability-matrix.md`.
    - Shared stage schema + business/offer normalization enforced in `lib/revenue/offers.ts`.
    - Source/template/job-start/day1 routes normalize to one business-unit + offer-code contract.

### 2) Productize offers + deposits (cash-first)
- [x] Rosser NFT Gallery: publish four packaged offers in Square catalog.
  - Mini replicas (existing catalog inventory)
  - Custom sculpture commissions
  - Historical preservation / replica projects
  - Private event rental
- [x] RT Solutions: publish four packaged offers in Square catalog.
  - Quick website launch sprint
  - AI education lunch-and-learn
  - AI team training workshop
  - Custom software/AI discovery + build path
- [x] Attach deposit policy per offer and required intake fields.
  - Evidence:
    - Canonical offer/deposit metadata in `lib/revenue/offers.ts`.
    - Packaging + import artifacts in `docs/plans/2026-02-24-dual-business-offer-catalog.md` and `docs/plans/2026-02-24-square-catalog-import.csv`.
    - Template/day1 flows carry `businessUnit` + `offerCode` through run creation and reporting.

### 3) Deterministic acquisition loop
- [x] Run stage workers in order: Source -> Enrich -> Score -> Outreach -> Booking.
- [x] Keep side-effect actions approval-gated (draft/send/booking/payment).
- [x] Set per-stage SLAs and retry/timeout policy.
- [x] Enforce idempotency keys on booking/outreach create paths.
  - Evidence:
    - Source + scoring pipeline in `app/api/leads/source/route.ts` and worker execution in `app/api/lead-runs/[runId]/jobs/worker/route.ts`.
    - Draft-first + dry-run controls carried in run config and day1 automation (`lib/revenue/day1-automation.ts`).
    - Retry/backoff policy enforced in worker route (`CALENDAR_RETRY_POLICY`, `CHANNEL_RETRY_POLICY`).
    - Idempotency keys applied for booking/outreach + channel actions via `buildLeadActionIdempotencyKey(...)`.

### 4) Close-rate tooling
- [x] Add per-offer proposal template + objection handling prompts.
- [x] Add booking scripts and next-step sequence by stage.
- [x] Define and automate follow-up cadence windows (D+2, D+5, D+10).
- [x] Extend cadence with D+14 recycle step + no-response branch.
- [x] Add "no-response" and "not-now" recycle logic.

### 5) Weekly KPI operating loop
- [x] Weekly KPI report/dashboard feed includes:
  - leads sourced
  - qualified leads
  - outreach-ready
  - meetings booked
  - deposits collected
  - close rate
  - cycle time (lead -> deposit)
- [x] Add weekly review ritual with explicit kill/scale decisions by offer and channel.

## Offer Packaging Rules (applies to both businesses)

- Every offer must have:
  - clear deliverable
  - fixed or bounded price range
  - deposit amount/rule
  - turnaround SLA
  - intake requirements
  - single CTA
- Any request outside packaged scope routes to a paid discovery call.

## Cross-Repo Contract

- Mission Control owns orchestration state and operator UX.
- OpenClaw owns channel runtime and action execution policies.
- Shared facts (services/pricing/rules) must be versioned and synced weekly.

## Risks + Mitigations

- Risk: identity/pricing drift across systems  
  Mitigation: weekly source-of-truth sync, versioned business profile updates.
- Risk: too many custom exceptions kill throughput  
  Mitigation: packaged offers first, discovery-first for exceptions.
- Risk: outreach volume without conversion  
  Mitigation: enforce weekly close-rate review and channel kill thresholds.

## Verification Gates

- [ ] Business profiles updated with packaged offers and deposit rules.
- [ ] Stage worker flow tested with dry-run and approval-gated live-run.
- [ ] Weekly KPI report generated from live pipeline data.
- [ ] No secrets committed; all connector keys env/Secret Manager only.

## Progress Log

- [x] Offer catalog draft created for both businesses (`docs/plans/2026-02-24-dual-business-offer-catalog.md`).
- [x] Proposal/follow-up templates drafted (`docs/plans/2026-02-24-offer-proposal-followup-templates.md`).
- [x] Square import CSV drafted with business-specific intake links (`docs/plans/2026-02-24-square-catalog-import.csv`).
- [x] Weekly KPI operating loop documented (`docs/plans/2026-02-24-weekly-kpi-loop.md`).
- [x] Day1 scheduler helpers now include deterministic D+2/D+5/D+10/D+14 follow-up seed jobs per business.
- [x] Follow-up worker now applies stage-aware booking scripts and branch logic (`standard`, `no_response`, `not_now`) via `lib/revenue/close-rate-playbooks.ts`.
- [x] Weekly KPI worker now emits deterministic decision logs to `identities/{uid}/revenue_kpi_decisions/*`.
- [x] Local quality gates pass for current implementation (`lint`, `unit`, `smoke`, `build`).
- [x] 2026-02-25 deployment + post-deploy smoke executed for `leadflow-review` (`npm run deploy:firebase`, `npm run test:postdeploy`).

## Local Ops Commands

- `npm run lint`
- `npm run test:unit`
- `npm run test:smoke`
