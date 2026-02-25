# Gap Analysis: YouTube Workflow vs Current Mission Control

Date: 2026-02-25  
Source: YouTube workflow transcript (`3110hx3ygp0`, user-provided)

## Already in place
- Draft-first email triage path and Gmail label routing.
- Follow-up queueing and Day1/Day2 revenue loop APIs.
- Multi-business templates (`rts`, `rng`, `aicf`) and scheduler automation.
- Telegram escalation channels and cross-business agent framework.
- Runtime safety controls and structured logs.

## Gaps to close next
- Sponsorship-style weighted rubric with explicit confidence scoring by dimension.
- Deterministic low-confidence escalation branch with approve/reject feedback loop.
- Full thread-aware draft generation guarantee with prior-thread digest pinning.
- CRM stage drift detector with automated reconciliation recommendations.
- Notification batching policy (critical immediate, high hourly, medium 3-hour).
- Prompt-stack dual maintenance (`root` + `codex`) with nightly drift checks.

## High-impact implementation order
1. Add rubric config + scoring telemetry to triage runtime.
2. Add confidence feedback capture endpoint (`approve_score`, `override_score`).
3. Add thread digest retrieval in draft prompt assembly.
4. Add CRM drift detector daily job + alert digest.
5. Add notification batching worker and priority queue.
6. Add model-guidance drift checker over prompt stacks.

## Success criteria
- Fewer low-quality drafts (operator acceptance rate improves week-over-week).
- Fewer manual corrections on stage mapping.
- Reduced notification noise without loss of critical alerting.
- No booking-link mismatch for tagged business units.
