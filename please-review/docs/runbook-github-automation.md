# Runbook: GitHub Repo Automation (Create/Push)

PLACEHOLDERS (set these before running commands)
- GITHUB_ORG=mrrosser
- GITHUB_REPO=ai-hell-mary
- GITHUB_TOKEN=PLACEHOLDER_GITHUB_TOKEN

Goal
- Enable safe, approval-gated repo creation and pushes.

Setup (local machine)
1) Authenticate GH CLI
- `gh auth login`

2) Create private repo
- `gh repo create ${GITHUB_ORG}/${GITHUB_REPO} --private --source=. --remote=origin`

3) Push initial commit
- `git add .`
- `git commit -m "chore: initial openclaw scaffold"`
- `git push -u origin main`

Safety
- Only push after explicit approval.
- Keep tokens in env vars or Secret Manager.
- Use least privilege scopes for GitHub tokens.

Auto Sync (optional)
- Scripts: `scripts/auto-sync.ps1` (Windows) or `scripts/auto-sync.sh` (Linux/WSL).
- Set `AUTO_SYNC=1` to enable.
- Optional:
  - `AUTO_SYNC_MESSAGE="chore: autosync"`
  - `AUTO_SYNC_INTERVAL=300` (seconds)
  - `AUTO_SYNC_SKIP_TESTS=1` (skip `npm test`)

Windows (PowerShell)
1) `setx AUTO_SYNC 1`
2) `powershell -File scripts\\auto-sync.ps1`

Linux/WSL
1) `export AUTO_SYNC=1`
2) `bash scripts/auto-sync.sh`

Notes
- Auto sync only runs on `main` and skips pushes on other branches.
- Stop with Ctrl+C.

