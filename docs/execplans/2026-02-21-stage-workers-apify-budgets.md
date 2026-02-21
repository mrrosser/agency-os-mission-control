# ExecPlan: Stage Workers + Sourcing Expansion (2026-02-21)

## Goal
Ship the selected roadmap batch:
1) enforce background worker execution path,
2) add lead provider abstraction + optional Apify adapter,
3) add Google Places pagination + configurable run limits,
4) add run budget guardrails (cost/pages/runtime hard stops),
5) add competitor-monitor scheduled scans with report artifacts.

## Scope
- Lead sourcing domain:
  - Introduce provider abstraction layer for source providers.
  - Keep existing providers (Google Places, Firestore) and add optional Apify Maps provider.
  - Add Google Places pagination support with capped pages and runtime guards.
  - Add budget policy fields to sourcing request and enforce stop conditions.
- Operations runtime:
  - Deprecate inline client-side lead processing path.
  - Keep a single worker-driven execution path (`/api/lead-runs/:runId/jobs`).
- Competitor monitoring:
  - Add APIs/helpers to run competitor scans on schedule.
  - Generate Markdown + HTML report artifacts.
  - Persist reports and expose retrieval endpoints.
- Tests:
  - Unit coverage for pagination and budget-guard behavior.
  - Smoke coverage for new competitor monitor endpoints.

## DoD (Verification Gates)
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:smoke`
- [x] `npm run build`
- [x] docs updated for local usage + deploy touchpoints

## Local Run / Verify
- `npm run dev`
- `npm run lint`
- `npm run test:unit`
- `npm run test:smoke`
- `npm run build`

## Deploy
- Firebase hosting/functions path already used by this repo:
  - `npm run deploy:firebase`
- If Cloud Run variants are used in your environment:
  - deploy the same build artifact via your existing `gcloud run deploy ...` flow.

## Notes
- No secrets committed; all provider tokens continue via env vars/Secret Manager.
- Changes are staged and reversible; existing behavior remains default when new provider/budget inputs are omitted.
- Verification completed on 2026-02-21 with all DoD gates passing.
