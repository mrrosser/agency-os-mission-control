---
name: rt-local-web-sales-loop
description: Run the RT Solutions local SMB website sales loop as a reusable skill (lead discovery, demo build, outreach, objection handling, and close ops). Use when asked to launch/operate the "find business without website -> send preview -> close" workflow.
---

# RT Local Web Sales Loop

## Purpose
Execute one standardized service workflow for RT Solutions with clear approval gates and idempotent external actions.

## Agent topology
1) `rt-orchestrator` (owns plan, routing, SLA)
2) `rt-lead-scout` (finds qualified local SMB leads)
3) `rt-site-demo-builder` (generates preview/demo site)
4) `rt-outreach` (drafts outreach with preview + payment CTA)
5) `rt-objection-handler` (handles replies and routes escalations)
6) `rt-closer-ops` (contract/payment handoff + CRM close)

## Required tool surfaces
- LeadOps MCP (`LEADOPS_MCP_SERVER_URL`) for lead pipeline writes and lifecycle stage transitions.
- SMAuto MCP (`SMAUTO_MCP_SERVER_URL`) for social/content execution tasks.
- Google Workspace + Twilio credentials only through env/Secret Manager.

## Workflow
1) Intake
   - Confirm target market, geo, offer SKU, pricing guardrails.
   - Open a correlation ID for the run and store it in every tool call.
2) Scout
   - Pull candidates with deterministic dedupe key: `business_name + phone + domain`.
   - Mark each record with stage `discovered`.
3) Demo
   - Build one preview per lead with idempotency key: `preview:{lead_id}:{template_version}`.
   - Store preview URL + checksum in lead metadata.
4) Outreach (approval-gated)
   - Draft message only by default.
   - Require human approval for send, pricing overrides, contract terms, payment links.
5) Objection handling
   - Route replies into buckets (`price`, `timing`, `trust`, `technical`).
   - Generate response draft + next action suggestion.
6) Close ops
   - Create/confirm quote, payment intent, and onboarding handoff checklist.
   - Move lifecycle to `won` or `lost` with explicit reason code.

## Guardrails
- Never expose secrets in prompts, docs, or commits.
- External create/update operations must be idempotent.
- If a connector is down, mark task as `pending_external_tool`; do not fake completion.
- Keep all outbound messages draft-first unless approval policy explicitly allows auto-send.
