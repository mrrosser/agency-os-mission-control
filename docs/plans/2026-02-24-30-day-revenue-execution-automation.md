# 30-Day Revenue Execution Automation

Date: 2026-02-24  
Owner: Mission Control

## Target outcomes (Day 30)
- 3 live offers running (RT websites, RNG creative, AI CoFoundry implementation).
- 5+ qualified opportunities per week per offer.
- 2+ closed deals/week across all offers.
- Daily operator review <= 20 minutes (automation first, approvals only).

## Non-negotiables
- Draft-first for outbound sends.
- Approval gates for pricing, contract, and payment links.
- Idempotent external writes with correlation IDs.
- No secrets in repo.

## Week 1 (Days 1-7): Offer + Pipeline Foundation
1. Finalize offer catalog and price bands for each business.
2. Load source lists and enforce stage schema (`discovered -> qualified -> proposal -> won/lost`).
3. Enable RT loop skill (`skills/rt-local-web-sales-loop/SKILL.md`) as the default RT execution flow.
4. Wire connector checks in Runtime Preflight + Agent Nexus (SMAuto/LeadOps MCP).
5. KPI baseline dashboard:
   - leads discovered/day
   - qualification rate
   - proposal count
   - close rate

### Day 1 implementation status (2026-02-24)
- Added Day 1 automation service routes:
  - `POST /api/revenue/day1` (authenticated operator run)
  - `POST /api/revenue/day1/worker-task` (token-auth service run)
- Added reusable Day 1 skill: `skills/revenue-day1-automation/SKILL.md`
- Added deployment + scheduler runbook: `docs/runbook-day1-revenue-automation.md`
- Day 1 now supports optional HeyGen queueing through `useAvatar` outreach config and identity-level avatar profile overrides.
- Added scheduler helper for three-business rollout + second follow-up seed pass:
  - `scripts/revenue-day1-scheduler-setup.sh`
  - `scripts/revenue-day1-run.mjs`
- Extended scheduler helper to queue deterministic D+5, D+10, and D+14 recycle follow-up seeds:
  - `revenue-day1-<business>-followup-seed-d5` (`followupSequence=2`, `followupDelayHours=120`)
  - `revenue-day1-<business>-followup-seed-d10` (`followupSequence=3`, `followupDelayHours=240`)
  - `revenue-day1-<business>-followup-seed-d14` (`followupSequence=4`, `followupDelayHours=336`, recycle branch)
- Existing same-day runs now support follow-up re-seeding without creating duplicate runs (`reused=true` path + `autoQueueFollowups=true`).

### Day 2 implementation status (2026-02-25)
- Added Day 2 orchestration routes:
  - `POST /api/revenue/day2` (authenticated operator run across one+ templates)
  - `POST /api/revenue/day2/worker-task` (token-auth service run, supports fallback to `REVENUE_DAY1_WORKER_TOKEN`)
- Added Day 2 automation service: `lib/revenue/day2-automation.ts`
  - executes Day 1 automation per template
  - enforces approval-safe outreach settings by default
  - processes due response tasks and re-dispatches follow-up worker drain when needed
- Added Day 2 runner + scheduler helpers:
  - `scripts/revenue-day2-run.mjs`
  - `scripts/revenue-day2-scheduler-setup.sh`
  - `scripts/revenue-day2-scheduler-setup.ps1`
- Added Day 2 operator/deploy runbook:
  - `docs/runbook-day2-revenue-automation.md`
- Added test coverage:
  - `tests/smoke/revenue-day2-route.test.ts`
  - `tests/smoke/revenue-day2-worker-task-route.test.ts`
  - `tests/unit/revenue-day2-automation.test.ts`

### Day 30 autopilot implementation status (2026-02-25)
- Added Day30 orchestration routes:
  - `POST /api/revenue/day30` (authenticated operator run)
  - `POST /api/revenue/day30/worker-task` (token-auth service run, supports fallback to Day2/Day1 worker token)
- Added Day30 automation service: `lib/revenue/day30-automation.ts`
  - executes Day2 automation
  - updates closer queue (hot booking/proposal leads with 30-minute SLA tracking)
  - syncs revenue memory summaries (win/loss + objection signals)
  - generates daily executive digest docs
  - runs weekly KPI + service-lab candidate generation on configured cadence
- Added Day30 runner + scheduler helpers:
  - `scripts/revenue-day30-run.mjs`
  - `scripts/revenue-day30-scheduler-setup.sh`
  - `scripts/revenue-day30-scheduler-setup.ps1`
- Added Day30 operator/deploy runbook:
  - `docs/runbook-day30-revenue-automation.md`
- Added test coverage:
  - `tests/smoke/revenue-day30-route.test.ts`
  - `tests/smoke/revenue-day30-worker-task-route.test.ts`
  - `tests/unit/revenue-day30-automation.test.ts`

### Variant + social approval status (2026-02-25)
- Added 7-day variant split reporting script and npm command:
  - `scripts/revenue-variant-split-report.mjs`
  - `npm run revenue:variant:report`
- Generated initial baseline report:
  - `docs/reports/2026-02-25-variant-split-7d.md`
- Added social draft approval workflow for IG/FB drafts with Google Space approval links:
  - `POST /api/social/drafts`
  - `POST /api/social/drafts/worker-task`
  - `GET /api/social/drafts/{draftId}/decision`
- Added approval auto-handoff queue for external social execution:
  - approved drafts now enqueue to `identities/{uid}/social_dispatch_queue/*` with `status=pending_external_tool`
- Added social dispatch drain worker:
  - `POST /api/social/drafts/dispatch/worker-task`
  - drains queued approved drafts to SMAuto MCP/webhook endpoint and records `dispatch.status=dispatched|failed`
- Added social approval runbook:
  - `docs/runbook-social-draft-approvals.md`

## Week 2 (Days 8-14): Outbound + Follow-up Automation
1. Activate daily lead scouting cadence (geo + niche rotations).
2. Generate demo assets and outreach drafts in batches.
3. Launch follow-up sequence automation (D+2, D+5, D+10, D+14 recycle) with suppression rules.
4. Add objection-response templates by bucket (`price`, `timing`, `trust`, `technical`).
5. Weekly checkpoint:
   - remove low-conversion channels
   - raise/lower qualification threshold based on response quality

## Week 3 (Days 15-21): Conversion Optimization
1. Add offer split tests:
   - headline/value prop variants
   - price packaging variants
   - CTA variant (`book call` vs `instant checkout`)
2. Route hot replies to closer queue with SLA < 30 min during business hours.
3. Tighten no-response recycling loop (reframe + resend with new proof element).
4. Add win/loss reason tagging and sync to revenue memory table.
5. Weekly checkpoint:
   - pause worst-performing offer variants
   - expand top 1-2 winning variants

## Week 4 (Days 22-30): Scale + Reliability
1. Expand geographic coverage and duplicate top-performing campaigns by segment.
2. Harden runbooks:
   - connector outage fallback
   - queue drain + retry behavior
   - manual override path
3. Publish executive daily digest across agent spaces:
   - pipeline movement
   - blockers
   - approvals pending
   - forecast next 7 days
4. Final Day-30 review:
   - revenue by offer
   - CAC proxy (time + tool spend)
   - retained automations vs manual work
   - weekly scale/fix/kill decision log trend

## Daily automation cadence (operator rhythm)
- 08:00: Morning pipeline digest + top priorities.
- 12:00: Midday exception report (stuck deals, failed runs, approval backlog).
- 17:00: End-of-day revenue snapshot + next-day queued actions.

## Exit criteria
- Each offer has a stable weekly pipeline.
- At least one reliable close path per offer.
- Mission Control and connectors run without SSH dependency for normal operations.
