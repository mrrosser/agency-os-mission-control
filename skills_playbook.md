# Skills Playbook (Local)

## Purpose
Use global shared skills and RT Infinite Loop references while keeping project truth in this repo.

## Global references
- Shared skills: `C:\CTO Projects\CodexSkills`
- RT loop playbook: `C:\CTO Projects\rt-infinite-loop\skills_playbook.md`

## Local source of truth
- Process/docs: `docs/`
- Exec plans: `docs/execplans/`
- Model prompting guidance: `docs/model-guidance/`
- Local skills:
  - `skills/rt-local-web-sales-loop/SKILL.md` (RT Solutions local SMB web-sales service loop)
  - `skills/revenue-day1-automation/SKILL.md` (Day 1 revenue automation service/worker skill)
  - `skills/revenue-day2-automation/SKILL.md` (Day 2 loop: Day1 + due-response processing + approval gates)
  - `skills/lead-comms-orchestrator/SKILL.md` (lead-gen + outreach communications + KPI sync orchestration)
  - `skills/folio-avatar-pipeline/SKILL.md` (folio/avatar video pipeline for personalized outbound drafts)
  - `skills/sponsor-inbox-crm-agent/SKILL.md` (sponsor/SMB inbox scoring + CRM sync + draft-first replies)
  - `skills/cross-business-brain-service-lab/SKILL.md` (cross-business digest + approval-gated service ideation loop)

## RT loop ownership
- RT loop is a global skill/workflow, not a repo-level CI workflow for this project.
- Use the global RT loop playbook/repo for loop orchestration.
- This repo runs its own quality gates in standard CI workflows.

## DoD gates (default)
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Smoke tests: `npm run test:smoke`
- Build: `npm run build`
- Dependency scan: `npm audit --audit-level=high`
- Secrets scan: `gitleaks` (CI installs and runs it)

## Default execution loop
1) Confirm active DoD from exec plan.
2) Implement only in-scope work.
3) Run local gates directly (`npm run lint`, `npm run test:unit`, `npm run test:smoke`, `npm run build`).
4) Keep `docs/reports/latest-run.md` updated and attach artifacts for CI runs.
