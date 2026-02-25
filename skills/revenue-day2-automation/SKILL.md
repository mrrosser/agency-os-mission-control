---
name: revenue-day2-automation
description: Run Day 2 of the 30-day revenue execution plan as an automated loop (Day1 sourcing + follow-up response processing) with draft-first approval gates.
---

# Revenue Day 2 Automation

## Purpose
Execute the Day 2 loop in a deterministic, approval-safe way:

1) run Day 1 automation for one+ templates  
2) process due response tasks from follow-up queue  
3) re-dispatch follow-up worker drain when pending tasks remain

## API surfaces
- Manual/authenticated run:
  - `POST /api/revenue/day2`
- Service-to-service worker:
  - `POST /api/revenue/day2/worker-task`
  - header `Authorization: Bearer $REVENUE_DAY2_WORKER_TOKEN`
  - fallback token: `REVENUE_DAY1_WORKER_TOKEN`

## Inputs
- `templateIds` (required string array)
- `dateKey` (optional `YYYY-MM-DD`)
- `dryRun` / `forceRun` (optional)
- `autoQueueFollowups` + follow-up seed tuning fields
- `processDueResponses` + `responseLoopMaxTasks`
- `requireApprovalGates` (default `true`)

Worker-task route also requires:
- `uid`

## Guardrails
- Approval-safe enforcement by default:
  - `outreach.draftFirst=true`
  - `outreach.useSMS=false`
  - `outreach.useOutboundCall=false`
- Idempotent run behavior inherited from Day 1 path.
- Structured logs and correlation IDs across route + orchestration.
- Secrets/tokens only via env/Secret Manager.

## Recommended cadence
- Daily run after Day 1 source pass.
- Keep response loop enabled to keep same-day inbox momentum.
- Only disable approval gates by explicit operator decision.
