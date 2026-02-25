---
name: revenue-day1-automation
description: Run Day 1 of the 30-day revenue execution plan as an automated service (lead sourcing + outreach job start + optional follow-up queue). Use when the operator asks to "run day 1", "kick off daily lead loop", or "start RT daily automation".
---

# Revenue Day 1 Automation

## Purpose
Execute the first day of the 30-day plan in a deterministic, idempotent way:

1) source leads from a saved template  
2) create a run with normalized offer metadata  
3) queue the lead-run worker (draft-first by default)  
4) optionally queue follow-up tasks

## API surfaces
- Manual/authenticated run:
  - `POST /api/revenue/day1`
- Service-to-service worker (for Cloud Scheduler / Cloud Tasks):
  - `POST /api/revenue/day1/worker-task`
  - header `Authorization: Bearer $REVENUE_DAY1_WORKER_TOKEN`

## Inputs
- `templateId` (required)
- `dateKey` (`YYYY-MM-DD`, optional; defaults to UTC date)
- `dryRun` (optional)
- `forceRun` (optional, creates a new run when same-day run exists)
- `autoQueueFollowups` (optional, default `true`)
- `followupDelayHours` (optional)
- `followupMaxLeads` (optional)
- `followupSequence` (optional)

Worker-task route also requires:
- `uid` (the operator/user identity to execute under)

## Guardrails
- Deterministic same-day run id for idempotency.
- Uses existing approval-first controls (`draftFirst` defaults to true unless template overrides).
- No secret material stored in repo; all runtime keys come from env/Secret Manager.
- Logs and tool calls include correlation ids.

## Recommended cadence
- Run once at business-start for each active offer template.
- Keep follow-up drafting enabled, but keep outbound send approvals human-gated.
- Use `forceRun=true` only for reruns after explicit operator review.
