# Cross-Business Brain + Service Lab Plan

Date: 2026-02-24  
Owner: Mission Control Ops

## Objective

Implement an agent loop that:
1. consolidates signals across all businesses daily, and  
2. proposes new services/offers using real demand and conversion data.

## Scope

- Shared digest across:
  - RT Solutions
  - Rosser NFT Gallery
  - AI CoFoundry
- Weekly service candidate generation.
- Human approval gate before any offer is published.

## Data sources

- `leads` and `lead_runs` pipeline movement
- KPI reports in `identities/{uid}/revenue_kpi_reports/*`
- Agent action queues/logs
- Objection/reason tags from close/loss updates

## Execution phases

### Phase 1: Digest Backbone
- Generate one daily digest doc (`identities/{uid}/executive_brain/daily/*`).
- Include:
  - top movement by business
  - approvals pending
  - blockers and failures
  - next 24h priorities

### Phase 2: Service Lab
- Weekly derive 3-5 service candidates into `identities/{uid}/service_lab_candidates/*`.
- Candidate schema:
  - title
  - target business
  - problem evidence
  - offer hypothesis
  - price band hypothesis
  - test design
  - status (`draft`, `approved`, `rejected`, `launched`)

### Phase 3: Operator Workflow
- Add dashboard panel for:
  - candidate review
  - approve/reject actions
  - launch-ready checklist

## Guardrails

- No auto-launch of services.
- Pricing/contracts/payments remain approval-gated.
- Tool calls must be idempotent for external writes.
- Keep secrets in env/Secret Manager only.
