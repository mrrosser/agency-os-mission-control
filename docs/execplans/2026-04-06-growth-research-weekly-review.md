# Growth Research Weekly Review

## Goal
- Surface the shared weekly `growth-research` loop inside Agent Nexus as a human review inbox.
- Keep Mission Control read-only against product repos while allowing reviewers to approve, reject, defer, or escalate shared weekly recommendations.

## Scope
- `app/api/agents/growth-research/route.ts`
- `app/api/agents/growth-research/review/route.ts`
- `components/operations/GrowthResearchInbox.tsx`
- `app/dashboard/agents/page.tsx`
- `lib/growth-research-contract.ts`
- `lib/growth-research.ts`
- `tests/unit/growth-research.test.ts`
- `tests/smoke/agents-growth-research-route.test.ts`
- `tests/smoke/agents-growth-research-review-route.test.ts`
- `README.md`

## Definition Of Done
- Agent Nexus exposes a weekly growth-research inbox.
- The inbox reads the shared weekly schema and metrics from CodexSkills.
- Review submissions call the shared `record_growth_research_review.ps1` recorder.
- The UI remains fail-closed when report roots or script roots are unavailable.
- Unit, smoke, and build verification pass.

## Status
- [x] Added growth-research read and review routes.
- [x] Added growth-research contract and reader/writer helpers.
- [x] Added dashboard inbox UI.
- [x] Added unit and smoke coverage.
- [x] Documented local env/runtime expectations.
- [x] Verified lint, unit, smoke, and build.
