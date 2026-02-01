# Runbook: GitHub (Issues/PRs)

PLACEHOLDERS (set these before running commands)
- GITHUB_ORG=mrrosser
- GITHUB_REPO=ai-hell-mary
- GITHUB_TOKEN=PLACEHOLDER_GITHUB_TOKEN (store in env or secret manager)

Goal
- Enable read-first GitHub workflows and approval-gated writes.

Steps
1) Create a fine-grained GitHub token
- Scope to specific repos and read-only permissions first.
- Store in an env var on the gateway (do not commit).

2) Configure CLI access
- Install `gh` CLI on the gateway or node host.
- Set `GITHUB_TOKEN` in the shell env.
- Ensure exec approvals allow `gh` commands you intend to run.

3) Approvals for writes
- Keep PR creation, branch creation, and issue comments behind explicit approval.
- Use the draft-first policy for any outbound text.

Notes
- Prefer `gh` CLI only with approvals and narrow scopes.

