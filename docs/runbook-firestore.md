# Runbook: Google Firestore (Read-First ? Write w/ Approvals)

PLACEHOLDERS (set these before running commands)
- GCP_PROJECT_ID=ai-hell-mary
- FIRESTORE_DATABASE=PLACEHOLDER (default: (default))
- FIRESTORE_SA_KEY_PATH=PLACEHOLDER_PATH

Goal
- Enable Firestore read-first access and optionally write with approvals.

Setup
1) Enable Firestore API in the project.
2) Create a dedicated service account and grant minimal roles:
- `roles/datastore.viewer` for read???only
- Upgrade to `roles/datastore.user` only when approvals are stable

3) Store service account JSON securely (do not commit).
4) Configure OpenClaw or MCP tooling to use the service account key.

Notes
- Treat Firestore data as sensitive.
- All writes should be approval-gated.

