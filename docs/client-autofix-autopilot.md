# Client Project Autopilot

## Purpose
Client Project Autopilot is the Mission Control workflow for client-visible failures. It creates a durable `clientAutofixRuns` record, binds the issue to an allowlisted client project adapter, queues the required sub-agent handoff, and blocks deploy completion or client follow-up until verifier evidence is green.

## Run Contract
`POST /api/agents/client-autofix`

Required payload fields:
- `client_id`: client tenant slug, for example `fortifyy_roofs`.
- `project_id`: allowlisted client project, for example `socialops`.
- `issue_summary`: plain-English description of the client-visible failure.

Optional payload fields:
- `repo_id`: project repo adapter, for example `smauto`.
- `trigger_source`: `client_email`, `client_issue`, `github_check`, `cloud_run_smoke`, `playwright`, or `manual`.
- `autonomy_mode`: defaults to `full_autopilot_client_projects`.
- `deploy_target`: `staging` or `production`.
- `evidence_bundle`: test, route, Playwright, deployment, and PR evidence.

Read endpoints:
- `GET /api/agents/client-autofix?limit=25`
- `GET /api/agents/client-autofix/{runId}`

## Evidence Gate
A run is not allowed to mark client follow-up as ready unless the evidence bundle includes:
- At least one passing test command.
- Route checks with no `404` and no `5xx`.
- Playwright visual evidence via screenshot or trace.

If evidence is missing or failing, the run status is `blocked_missing_evidence` and `client_followup_status` remains `held_until_verified`.

## Safety Defaults
- Only allowlisted client projects can run.
- `MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED=true` blocks all runs.
- Project-level kill switches block individual adapters.
- Missing GitHub remotes report `push_blocked_missing_remote`; local patch/test can proceed, but push/PR is blocked.
- Social publishing stays behind the existing approval gates. This workflow can fix approval tooling, but it does not bypass client approval.

## Current Adapter
The first adapter is `socialops` / `smauto`.

Verifier commands:
- `python -m pytest -q`
- Orchestrator social posting tests.
- `socialops-client` lint, tests, and build.
- `scripts\smoke_orchestrator_clients.ps1`.
- Shared Playwright spec in `C:\CTO Projects\ui-tests\tests\socialops-client.smoke.spec.ts`.

## Client-Project Verification Loop (SocialOps/Fortifyy)
For verification-only runs (no social publishing, no client email autosend), use the repo-local runner:

- `powershell -ExecutionPolicy Bypass -File scripts\\client-project-autopilot-verify.ps1 -ProjectId socialops -ClientId fortifyy_roofs -DeployTarget production`

Notes:
- Kill switches are evaluated before any external calls (`MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED`, `CLIENT_AUTOFIX_SOCIALOPS_DISABLED`, `CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY`).
- The public review Playwright spec requires the SocialOps review token; the runner resolves it from Secret Manager via `gcloud` without printing the value.
- The authenticated smoke requires `C:\\CTO Projects\\ui-tests\\storage\\socialops-client.json`. If stale/missing, `scripts\\bootstrap_socialops_storage_state.cjs` can refresh it from Secret Manager when configured via `SOCIALOPS_GCP_PROJECT_ID` + `SOCIALOPS_PLAYWRIGHT_STORAGE_STATE_SECRET`.

Deployment commands:
- Staging: `socialops-client\deploy.ps1 -Service socialops-client-staging`
- Production: `socialops-client\deploy.ps1 -Service socialops-client`

Required client-visible checks for Beth/Fortifyy:
- `/api/health`
- `/sign-in`
- `/approvals?client_id=fortifyy_roofs`
- `/calendar?client_id=fortifyy_roofs`
- `/assets?client_id=fortifyy_roofs`
