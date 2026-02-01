# IAM Service Accounts

Gateway Service Account
- Purpose: run OpenClaw Gateway and perform read-only discovery.
- Recommended roles (start minimal):
  - `roles/logging.logWriter`
  - `roles/monitoring.metricWriter`
  - `roles/run.viewer`

Optional (only if needed)
- `roles/storage.objectViewer` (read-only access to GCS if required)
- `roles/secretmanager.secretAccessor` (if you store secrets in Secret Manager)

Notes
- Avoid `roles/run.admin` until approvals and policies are stable.
- Use separate service accounts for different environments (dev/stage/prod).
