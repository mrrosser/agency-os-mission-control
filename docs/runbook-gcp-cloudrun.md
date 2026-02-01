# Runbook: GCP Cloud Run (Read-first)

PLACEHOLDERS (set these before running commands)
- GCP_PROJECT_ID=ai-hell-mary
- GCP_REGION=us-central1
- CLOUDRUN_SERVICE_ALLOWLIST=PLACEHOLDER_SERVICE_NAMES_CSV
- GCP_SA_EMAIL=PLACEHOLDER_GCP_SA_EMAIL

Goal
- Enable discovery of Cloud Run services in read-only mode.
- Gate any deploy/change actions behind explicit approvals.

Steps
1) Configure gcloud on the gateway
- Install gcloud (or use an official container) on the VM.
- Authenticate using a dedicated service account.

2) Assign read-only roles
- Recommended minimum: `roles/run.viewer`.
- Avoid `roles/run.admin` until approvals and policies are stable.

3) Exec approvals for gcloud
- Add specific `gcloud run services list/describe` commands to exec approvals.
- Keep `gcloud run deploy` blocked until explicit approval.

4) Validate read-only
- Use `gcloud run services list` and `gcloud run services describe` as read actions.

5) Approval-gated deploys (later)
- Only enable deploy after a security audit and explicit approvals on each deploy command.

Notes
- Keep logs structured and include correlation IDs for any tool actions.
- If you want MCP-based access, use the MCP Registry scripts to find a Cloud Run/GCP server.
