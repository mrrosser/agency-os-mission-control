# Runbook: Write Mode (Read + Write + Exec + Outbound w/ Approvals)

Goal
- Enable write actions while keeping approvals and audit logging.

Why read-only was default
- Safer bootstrapping: avoid accidental sends, edits, or deletes until approvals are stable.

Enable write mode (recommended)
1) Apply the write-enabled template:
- `cp config-templates/openclaw.json.write.template data/openclaw/openclaw.json`
2) Or use the toggle script (keeps your current config):
- `bash scripts/enable_write_mode.sh`
3) Restart gateway:
- `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`

Notes
- Exec approvals are still enforced via `~/.openclaw/exec-approvals.json`.
- For outbound messaging, keep the draft-first policy in the workspace. To hard-stop outbound, add `message` to `tools.deny`.
- To revert: `bash scripts/disable_write_mode.sh`
