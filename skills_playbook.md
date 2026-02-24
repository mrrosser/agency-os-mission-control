# Skills Playbook (Local)

## Purpose
Use global shared skills and RT Infinite Loop references while keeping project truth in this repo.

## Global references
- Shared skills: `C:\CTO Projects\CodexSkills`
- RT loop playbook: `C:\CTO Projects\rt-infinite-loop\skills_playbook.md`

## Local source of truth
- Process/docs: `docs/`
- Exec plans: `docs/execplans/`

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
