---
name: lead-comms-orchestrator
description: Run the lead generation plus outreach communications loop (email draft, optional SMS/call escalation, avatar-video handoff, and KPI sync) with approval-first defaults and idempotent execution.
---

# Lead Comms Orchestrator

## Purpose
Use this skill to operate one deterministic revenue and outreach loop across lead sourcing, communications, and KPI reporting.

## Core entrypoints
- `scripts/revenue-day1-run.mjs`
- `scripts/revenue-day2-run.mjs`
- `scripts/revenue-day30-run.mjs`
- `scripts/revenue-weekly-kpi-run.mjs`
- `scripts/social-draft-run.mjs`
- `scripts/social-dispatch-run.mjs`

## Communication surfaces
- Email draft: `POST /api/gmail/draft`
- Email send: `POST /api/gmail/send`
- SMS: `POST /api/twilio/send-sms`
- Voice call: `POST /api/twilio/make-call`
- Avatar video create/status: `POST /api/heygen/create-avatar`, `POST /api/heygen/get-status`

## Workflow
1. Run Day 1 sourcing with deterministic idempotency keys.
2. Run Day 2 response processing with approval gates kept enabled.
3. Run Day 30 for closer queue and optional weekly KPI rollup.
4. Keep outbound contact draft-first unless explicit execute approval exists.
5. Use SMS/call/avatar as escalation channels only for qualified leads.
6. Publish KPI summary and decision mix (`scale/fix/kill/watch`) after each cycle.

## Guardrails
- Keep `outreach.draftFirst=true` as default.
- Do not auto-send external communications without explicit approval policy.
- Use Do-Not-Contact checks before any outbound action.
- Use env/Secret Manager for all provider credentials.
- Include correlation IDs on every automation run and tool call.

## Verification
- `npm run revenue:day1:run`
- `npm run revenue:day2:run`
- `npm run revenue:day30:run`
- `npm run revenue:variant:report`
- `npm run social:dispatch:smoke`

## Example prompts
- "Run the lead comms loop in dry-run mode and summarize blocked approvals."
- "Execute Day 2 with approval gates on and report response queue completion."
- "Generate this week KPI rollup and list scale/fix/kill/watch decisions."

