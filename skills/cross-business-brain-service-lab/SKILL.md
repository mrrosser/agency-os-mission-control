---
name: cross-business-brain-service-lab
description: Maintain a cross-business executive memory loop and generate approval-gated service ideas from live outcomes. Use when asked to make agents learn across businesses and propose/create new services.
---

# Cross-Business Brain + Service Lab

## Purpose
Create one shared operational intelligence loop across all business units:
- RT Solutions
- Rosser NFT Gallery
- AI CoFoundry

## Inputs
- Pipeline state by business (`lead_capture -> won/lost`)
- Weekly KPI summaries
- Win/loss reasons and objection buckets
- Activity feeds from agent spaces

## Outputs
1. **Executive digest** (daily):
   - movement by business
   - blockers
   - pending approvals
   - next 24h actions
2. **Service lab candidates** (weekly):
   - proposed offer/service
   - evidence (demand + conversion gaps)
   - pricing hypothesis
   - launch test plan

## Guardrails
- No autonomous publishing of new offers.
- Every new service candidate remains `draft` until human approval.
- Any pricing/contract/payment action stays approval-gated.
- Never store secrets in skill memory or repo files.

## Recommended cadence
- 08:15 CT daily: generate cross-business digest.
- Friday 16:00 CT: generate/update service lab candidates.
- Monday operator review: approve/reject candidates.
