# ExecPlan: Cadence Hardening (Steps 1-4)

## Goal
Ship the current Mission Control lead-gen hardening slice without changing the external user-facing Mission Control UI:
1) lock and verify Day1/Day2/Day30 production cadence,
2) make enrichment resilient under Firecrawl quota pressure,
3) close runtime auth/connectivity blind spots for cadence workers,
4) automate weekly keep/fix/kill decision loop outputs.

## Scope
- `scripts/revenue-cadence-audit.mjs`
- `lib/leads/sourcing.ts`
- `lib/leads/providers/firecrawl.ts`
- `lib/runtime/preflight.ts`
- `.github/workflows/revenue-variant-decisions.yml`
- `docs/runbook-day1-revenue-automation.md`
- `docs/runbook-day2-revenue-automation.md`
- `docs/runbook-day30-revenue-automation.md`
- `tests/unit/lead-sourcing-firecrawl-cooldown.test.ts`
- `tests/unit/runtime-preflight.test.ts`

## Out of Scope
- Frontend Mission Control UX changes for external users.
- OpenClaw app-side dashboards/UI.
- Offer catalog/landing-page copy changes.

## DoD Gates
- [x] `npm run lint`
- [x] `npx vitest run tests/unit/lead-sourcing-firecrawl-cooldown.test.ts tests/unit/runtime-preflight.test.ts`
- [x] `npm run test:smoke`
- [x] Cadence audit script documented in day1/day2/day30 runbooks
- [x] Weekly variant decision workflow added with WIF auth and artifacts

## Progress
- [x] Step 1: Added `scripts/revenue-cadence-audit.mjs` and `npm run revenue:cadence:audit`; verified live scheduler payloads in `leadflow-review/us-central1`.
- [x] Step 2: Added quota-triggered cooldown in `lib/leads/sourcing.ts` with surfaced warnings + test coverage in `tests/unit/lead-sourcing-firecrawl-cooldown.test.ts`.
- [x] Step 3: Added runtime preflight checks for revenue worker token / automation uid / weekly KPI worker token in `lib/runtime/preflight.ts` + tests.
- [x] Step 4: Added weekly variant decision workflow `.github/workflows/revenue-variant-decisions.yml` (WIF auth + uploaded decision artifacts).
