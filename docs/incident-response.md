# Incident Response

Trigger examples
- Unexpected outbound messages
- Unauthorized tool/exec attempts
- Credential leak or suspected compromise

Immediate actions
1) Enable stop switch
- Set `channels.googlechat.enabled` / `channels.telegram.enabled` to `false`.
- Add `message`, `group:runtime`, and `group:fs` to `tools.deny`.
- Restart gateway: `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`

2) Cut external access
- Disable any public webhook paths (Tailscale Funnel / reverse proxy rules).
- Remove allowlisted users/groups temporarily.

3) Rotate credentials
- Follow `scripts/rotate_secrets_checklist.sh`.
- Revoke OAuth tokens and API keys as needed.

4) Preserve evidence
- Snapshot logs from gateway and node.
- Store logs securely for review.

5) Triage and fix
- Identify root cause (prompt injection, misconfiguration, missing allowlist, etc.).
- Apply security audit: `openclaw security audit --deep --fix`.

6) Resume safely
- Re-enable channels/tools one at a time.
- Keep approvals at strict mode until stable.
