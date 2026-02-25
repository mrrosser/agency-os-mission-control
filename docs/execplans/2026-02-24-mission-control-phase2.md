# ExecPlan: Mission Control Phase 2 + RT Six-Agent Loop

Date: 2026-02-24  
Owner: Codex / Marcus  
Status: In Progress (D1-D3 complete, D4 hardening in progress)

## Goals

1. Refresh Mission Control UI to match the operator-first style from referenced examples:
   - clear agent roster
   - live activity feed
   - task/decision visibility
   - fast per-agent drill-down
2. Stand up a production RT Solutions six-agent loop for local SMB website sales.
3. Integrate existing backend systems as tools (not merged codebases):
   - `C:\CTO Projects\agency-os-mission-control`
   - `C:\CTO Projects\SMAuto`
   - `C:\CTO Projects\agency-os-mission-control` OpenClaw control plane

## Constraints

- No secrets in repo; env/Secret Manager only.
- Keep changes incremental and reversible.
- Tool-first design for all external actions.
- Add unit + smoke tests for new behavior.
- Use structured logs + correlation IDs for UI/API actions.

## Architecture Direction

- **Mission Control (this repo)** remains operator UI + orchestration control plane.
- **OpenClaw Gateway VM** remains runtime execution + channel routing.
- **SMAuto** is consumed as external MCP tool surface for social execution.
- **LeadOps Mission Control features** are consumed as APIs/tool calls, not source merge.

## Deliverables

### D1. Mission Control UI Upgrade
- Enhance `/dashboard/agents` layout with:
  - left agent rail (status, last heartbeat, model alias)
  - center mission/task board
  - right live feed (events, comments, decisions, alerts)
- Add per-agent quick actions (pause/ping/route).
- Add timeline filters (all/tasks/comments/status/decisions).

### D2. RT Solutions Six-Agent Loop
- Define six agents with explicit roles and handoff boundaries:
  1. `rt-orchestrator`
  2. `rt-lead-scout`
  3. `rt-site-demo-builder`
  4. `rt-outreach`
  5. `rt-objection-handler`
  6. `rt-closer-ops`
- Add approval gates for pricing, contract, payment, and outbound sends.
- Implement idempotent lead lifecycle stages and receipts.

### D3. Cross-Project Tooling
- Register SMAuto endpoints as callable tools from OpenClaw/Mission Control.
- Add capability matrix doc: which actions are served by which backend.
- Add fallback behavior when an external tool is unavailable.

### D4. Ops + Safety
- Enable memory-flush + session-memory search flags in OpenClaw config.
- Harden runbooks for token reauth + chat-space bindings.
- Add weekly memory maintenance workflow prompt pack (reviewed prompts only).

## Verification Gates

1. UI smoke:
   - `/dashboard/agents` loads
   - live feed renders non-empty with seeded fixtures
2. API/unit:
   - control-plane snapshot format stable
   - agent status mapping deterministic
3. Integration:
   - mkt-social/research-intel spaces route to correct agents
   - triage remains healthy after config changes
4. Safety:
   - no secrets committed
   - all external create/update paths idempotent

## Progress Log

- [x] Gmail reauth recovered for all four accounts on gateway VM.
- [x] Google Chat spaces created:
  - `mkt-social` -> `spaces/AAQAcKXw-dU`
  - `research-intel` -> `spaces/AAQA84U_woE`
- [x] OpenClaw bindings updated for `mkt-social` and `research-intel`.
- [x] RT Solutions knowledge pack updated with canonical website + shared Twilio line.
- [x] Enabled OpenClaw config:
  - `agents.defaults.compaction.memoryFlush.enabled=true`
  - `agents.defaults.memorySearch.experimental.sessionMemory=true`
  - `agents.defaults.memorySearch.sources=["memory","sessions"]`
- [x] Implement Mission Control UI phase-2 layout updates in code (`/dashboard/agents` live feed + timeline filters + per-agent actions).
- [x] Implement RT six-agent loop as reusable skill (`skills/rt-local-web-sales-loop/SKILL.md`).
- [x] Wire SMAuto + LeadOps MCP endpoints into runtime capability matrix (`docs/runtime-capability-matrix.md`) and runtime preflight/control-plane checks.
- [x] Drafted 30-day execution automation plan (`docs/plans/2026-02-24-30-day-revenue-execution-automation.md`).
- [x] Implemented Day 1 revenue automation service routes + runbook (`/api/revenue/day1`, `/api/revenue/day1/worker-task`, `docs/runbook-day1-revenue-automation.md`).
- [x] Added scheduler/run scripts for Day 1 multi-business automation (`scripts/revenue-day1-run.mjs`, `scripts/revenue-day1-scheduler-setup.sh`) with America/Chicago defaults.
- [x] Added cross-business brain + service lab planning/skill scaffolding (`docs/plans/2026-02-24-cross-business-brain-service-lab.md`, `skills/cross-business-brain-service-lab/SKILL.md`).
- [x] Added internal revenue UI guardrail (`NEXT_PUBLIC_ENABLE_INTERNAL_REVENUE_UI`) so external users keep the same default interface.
- [x] Added idempotent Square payment webhook (`POST /api/webhooks/square`) to advance lead stage to `deposit_received` with replay protection via `square_webhook_events`.
- [x] Added weekly KPI rollup engine + routes (`/api/revenue/kpi/weekly`, `/api/revenue/kpi/weekly/worker-task`) and scheduler workflow (`.github/workflows/revenue-weekly-kpi.yml`).
- [x] Added Mission Control -> AI_HELL_MARY sync tooling (`scripts/sync-ai-hell-mary.mjs`, `scripts/sync-ai-hell-mary-nightly.ps1`) and rollout runbook (`docs/runbook-revenue-sync-and-kpi.md`).
- [x] Verification gates passed locally after crash recovery (`npm run lint`, `npm run test:unit`, `npm run test:smoke`, `npm run build`).
