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

