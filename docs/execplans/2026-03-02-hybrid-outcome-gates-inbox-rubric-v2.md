# ExecPlan: Hybrid Outcome Gates + Inbox Rubric v2

Date: 2026-03-02  
Owner: Mission Control  
Status: In Progress (stage/prod rollout pending)

## Scope

1. Standardize revenue gate evaluation to canonical execplan model (`throughput`, `qualification`, `meeting`, `revenue`, `pipeline`).
2. Persist canonical gate payload in weekly KPI artifacts and health report generation.
3. Upgrade inbox triage to weighted rubric v2 with confidence thresholding while preserving legacy bucket compatibility.
4. Update tests/docs/runbook for local verification and staged rollout.

## Deliverables

- `lib/revenue/outcome-gates.ts` for deterministic gate + readiness evaluation.
- `lib/revenue/weekly-kpi.ts` persists `outcomeGates` and `outcomeGateReadiness`.
- `scripts/revenue-weekly-health-report.mjs` renders canonical gates as primary health table.
- `lib/agent-control-plane.ts` gate-aware KPI state derivation.
- `lib/inbox/triage.ts` rubric v2 dimensions/sponsor buckets/suggested action.
- `app/api/gmail/inbox/route.ts` structured v2 logging + response summary extensions.
- `lib/google/gmail.ts` typed optional `triage` payload.
- `components/gmail/InboxList.tsx` scan-friendly triage badge + confidence.
- Unit/smoke tests covering both workstreams.

## Definition of Done

- [x] Inbox API remains backward compatible (`bucket` + legacy counts still present).
- [x] Inbox API returns v2 fields (`rubricVersion`, dimensions, sponsor bucket, low-confidence metadata).
- [x] Weekly KPI docs include canonical `outcomeGates`.
- [x] Weekly health artifacts treat canonical gates as primary.
- [x] Control-plane KPI state degrades on critical gate fail or stale/no report.
- [x] Unit and smoke tests updated/added for new schemas and logic.
- [ ] Stage rollout checks pass.
- [ ] Production rollout checks pass.
- [ ] Two-week gate evidence (`>=3/5 pass|warn`, 2 consecutive weeks) confirmed.

## Test Gates

Run locally:
```bash
npm run lint
npm run test:unit
npm run test:smoke
npm run build
```

## Rollout Notes

Stage:
1. Deploy preview.
2. Verify `POST /api/gmail/inbox` includes rubric v2 fields.
3. Verify `POST /api/revenue/kpi/weekly/worker-task` includes `report.outcomeGates`.
4. Run `npm run revenue:weekly:health` with stage creds and verify canonical gate table.

Production:
1. Promote after stage checks are green.
2. Validate `GET /api/runtime/preflight`.
3. Re-run KPI worker and inbox endpoints.
4. Confirm Firestore `revenue_kpi_reports/latest` includes `outcomeGates`.

## Residual Risks

- Firecrawl quota/account exhaustion can still reduce enrichment fidelity; fallback remains enabled.
- Legacy consumers may rely on implicit rubric v1 assumptions; compatibility is maintained through legacy bucket mapping.
- Two-week evidence closure depends on real weekly throughput/revenue data generation, not same-day execution.

