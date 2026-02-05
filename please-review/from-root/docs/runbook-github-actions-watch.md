# Runbook: GitHub Actions Watch

Goal
- Watch GitHub Actions runs until success/failure without manual polling.

Prerequisite
- Install GitHub CLI and authenticate (`gh auth login`).

Windows (PowerShell)
- Watch the latest run:
  - `powershell -File scripts\gh-actions-watch.ps1`
- Custom repo/interval:
  - `powershell -File scripts\gh-actions-watch.ps1 -Repo mrrosser/AI-Hell-Mary -IntervalSeconds 30`

Linux/WSL
- `bash scripts/gh-actions-watch.sh mrrosser/AI-Hell-Mary 30`

Notes
- Exits once the latest run has a conclusion.
- Use `gh run view <id> --log-failed` to open the failed steps.
