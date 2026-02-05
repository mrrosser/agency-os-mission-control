# Security Checklist

Gateway
- [ ] Gateway binds to `127.0.0.1` only.
- [ ] Access via SSH tunnel or Tailscale; no public ports.
- [ ] Docker volumes mapped to `data/openclaw` and `data/openclaw/workspace` only.
- [ ] Exec approvals file installed at `data/openclaw/exec-approvals.json`.
- [ ] Stop switch tested (channels disabled + tools.deny includes message + group:runtime + group:fs).

Node Host (Windows/WSL2)
- [ ] Exec approvals allowlist applied.
- [ ] Node connects only via tunnel/tailnet.
- [ ] No secrets stored in repo or command history.

Channels
- [ ] DM allowlist enabled.
- [ ] Group allowlist enabled.
- [ ] `requireMention` enabled for groups.
- [ ] Draft-first policy enforced.
- [ ] Social networks treated as untrusted; no secrets shared.

Integrations
- [ ] Hook/MCP/CLI integrations are read-first by policy.
- [ ] Write actions require explicit approval (exec approvals + draft-first).

Logs & Monitoring
- [ ] JSON logs enabled.
- [ ] Correlation ID attached to tool calls and outbound messages.
- [ ] Redaction list includes tokens and auth headers.

Operational
- [ ] Incident response runbook reviewed.
- [ ] Secrets rotation checklist ready.
