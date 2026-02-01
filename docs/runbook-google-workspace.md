# Runbook: Google Workspace (Gmail/Drive/Calendar + Admin)

Goal
- Consolidate Google Workspace APIs under a single runbook.

Includes
- Gmail API
- Google Drive API
- Google Calendar API
- Optional Admin SDK (Directory API) for user/group management

Notes
- Use OAuth per account.
- Keep write actions approval-gated.
- For Admin SDK, use the least-privileged service account and restrict scopes.
