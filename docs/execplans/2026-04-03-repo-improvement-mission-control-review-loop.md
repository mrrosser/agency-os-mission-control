# Repo Improvement Mission Control Review Loop

## Goal
- Surface the overnight `repo-improvement` inbox inside Mission Control.
- Let operators review pending items with `approve`, `reject`, `defer`, or `needs-human`.
- Submit review decisions back to the shared CodexSkills review ledger through the existing PowerShell recorder.

## Scope
- `app/api/agents/repo-improvement/route.ts`
- `app/api/agents/repo-improvement/review/route.ts`
- `app/dashboard/agents/page.tsx`
- `components/operations/RepoImprovementInbox.tsx`
- `lib/repo-improvement-contract.ts`
- `lib/repo-improvement.ts`
- `tests/unit/repo-improvement.test.ts`
- `tests/smoke/agents-repo-improvement-route.test.ts`
- `tests/smoke/agents-repo-improvement-review-route.test.ts`
- `README.md`

## Definition of done
- Agent Nexus shows the overnight repo-improvement inbox with pending review items and live metrics.
- Mission Control reads the shared morning review schema and metrics artifacts without crashing when they are absent.
- Mission Control can post review decisions back through `record_repo_improvement_review.ps1`.
- Review submission is authenticated, idempotent, and optionally UID-gated.
- Unit and smoke coverage exists for the helper and both new API routes.
- Local run and deploy notes document the path/env requirements for workstation and hosted environments.

## Status
- [x] Repo-local execplan added.
- [x] Shared repo-improvement contract + server helper added.
- [x] Read route added for morning review schema + metrics.
- [x] Review submission route added with auth + idempotency + optional allowlist.
- [x] Agent Nexus UI updated with overnight review inbox.
- [x] Unit + smoke tests added.
- [x] README updated with local run + deploy notes.
