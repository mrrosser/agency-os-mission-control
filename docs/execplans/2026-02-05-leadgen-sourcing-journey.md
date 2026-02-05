# ExecPlan: Lead Sourcing + Journey UI (2026-02-05)

## Goal
Replace mock lead generation with real sourcing + scoring, surface a lead journey visualization (MCP + AI steps), and align UI copy to lead-gen intent.

## Scope
- Server: lead sourcing API with scoring + idempotent runs + Secret Manager key check.
- Client: operations flow uses sourcing API; add lead journey panel.
- UI copy: align dashboard/login/operations/settings wording to lead generation.
- Tests: unit + smoke for scoring/provider/journey; mock external fetches.

## Out of Scope (for this iteration)
- Paid enrichment providers (Clearbit/Apollo/etc.).
- Full automated email discovery.
- Replacing all UI language everywhere.

## Plan
1) Add lead sourcing + scoring core (types, scoring, providers, API route) with structured logs + idempotency.
2) Update settings + secrets to support Google Places key; update operations flow to use API results.
3) Add Lead Journey UI + copy updates; update tests and run suite.
4) Verify deploy pipeline status and (after push) confirm live site via Playwright.

## Risks & Mitigations
- Missing provider key: API returns actionable error + UI hint to configure key.
- External API latency: timeouts + partial results with warnings.
- Lead contact gaps: journeys mark steps as skipped when email/phone unavailable.

## Test Plan
- `npm test`
- (Post-deploy) Playwright smoke against live login + dashboard.

## Rollback
Revert commit(s) touching lead sourcing API + operations UI; redeploy via GitHub Actions.
