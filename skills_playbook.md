# Skills Playbook (Local)

## Purpose
Use global shared skills and RT Infinite Loop references while keeping project truth in this repo.

## Global references
- Shared skills: `C:\CTO Projects\CodexSkills`
- RT loop playbook: `C:\CTO Projects\rt-infinite-loop\skills_playbook.md`

## Local source of truth
- Process/docs: `docs/`
- Exec plans: `docs/execplans/`

## Loop contract (this repo)
- Runner (Windows): `scripts/loop/run.ps1`
- Runner (CI/Linux): `scripts/loop/run.sh`
- Report output: `docs/reports/latest-run.md`

Run the full gate set:
```powershell
.\scripts\loop\run.ps1
```

CI runner:
```bash
bash scripts/loop/run.sh
```

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
3) Run gates via `scripts/loop/run.ps1` (Windows) or `scripts/loop/run.sh` (CI/Linux).
4) Keep `docs/reports/latest-run.md` updated and attach artifacts for CI runs.
