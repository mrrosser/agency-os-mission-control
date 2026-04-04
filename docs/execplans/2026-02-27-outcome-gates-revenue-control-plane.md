# ExecPlan: Outcome Gates for Revenue Control Plane

Date: 2026-02-27  
Owner: Mission Control  
Status: In Progress (implementation complete; evidence gate pending)

## Goal

Replace activity-based progress tracking with numeric weekly outcome gates that decide whether to scale, fix, or pause automation loops.

## Baseline (2026-02-27 live data)

- Source: `docs/reports/2026-02-27-weekly-kpi-live.md`
- Week window: 2026-02-23 -> 2026-03-01
- Leads sourced: `0`
- Qualified leads: `0`
- Meetings booked: `0`
- Deposits collected: `0`
- Deals won: `0`
- Pipeline value USD: `0`

## Weekly Outcome Gates

1. Throughput gate
- Metric: sourced leads per week
- Pass threshold: `>= 10`
- Warn threshold: `5-9`
- Fail threshold: `< 5`

2. Qualification gate
- Metric: qualified leads / sourced leads
- Pass threshold: `>= 20%`
- Warn threshold: `10-19.9%`
- Fail threshold: `< 10%`

3. Meeting gate
- Metric: meetings booked / sourced leads
- Pass threshold: `>= 15%`
- Warn threshold: `8-14.9%`
- Fail threshold: `< 8%`

4. Revenue gate
- Metric: deposits collected per week
- Pass threshold: `>= 1`
- Warn threshold: `0` with `>= 2` meetings
- Fail threshold: `0` with `< 2` meetings

5. Pipeline gate
- Metric: active pipeline value (USD)
- Pass threshold: `>= 5000`
- Warn threshold: `2000-4999`
- Fail threshold: `< 2000`

## Implementation Scope

- Keep all existing approval gates and idempotency rules.
- Use fallback enrichment when Firecrawl is missing or quota constrained.
- Publish one deterministic weekly health artifact with gate status and action recommendations.
- Keep smoke tests for control-plane snapshot + non-empty live feed generation.

## Verification Gates

- [x] Weekly health artifact automation exists (`scripts/revenue-weekly-health-report.mjs`, `.github/workflows/revenue-weekly-health.yml`).
- [x] Lead enrichment fallback is active for Firecrawl missing/cooldown/quota paths with tests.
- [x] Inbox triage emits rubric version + confidence in API response and structured logs.
- [x] Agent dashboard data path has seeded non-empty live-feed smoke coverage.
- [ ] Two consecutive weekly reports show at least 3/5 gates at `pass` or `warn`.

## Progress Update (2026-03-02)

- Canonical gate evaluator is now implemented in `lib/revenue/outcome-gates.ts` and persisted in weekly KPI docs as `outcomeGates`.
- Weekly KPI rollup now computes deterministic gate status and consecutive-week readiness (`outcomeGateReadiness`).
- Weekly business health artifact now uses canonical gates as primary and keeps variant decisions as supporting signals.
- Control-plane revenue KPI state is gate-aware (`operational` only when fresh report has no critical gate failures).
- Remaining open item is unchanged: close the two-week evidence gate after a second qualifying weekly report.

## Operating Cadence

- Monday 15:00 UTC: weekly KPI rollup workflow.
- Monday 16:10 UTC: variant decision workflow.
- Monday 17:00 UTC: weekly business health artifact workflow.
- Tuesday operator review: apply one explicit `scale`, `fix`, or `pause` decision per offer/channel segment.

## Exit Criteria

- At least 4/5 gates at `pass` for two consecutive weeks.
- No critical gate (`throughput`, `revenue`) in `fail` state for two consecutive weeks.
