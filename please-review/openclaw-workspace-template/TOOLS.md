# TOOLS

Principles
- Tool-first: always prefer tools for state or facts.
- Read-first: run read-only tools before any write.
- Approval-gated: require explicit approval for outbound messages, writes, and exec.
- Idempotent: check for existing resources before creating new ones.

Correlation IDs
- Each tool call must include a `correlation_id` in the log entry.
- Use the same correlation ID across related actions (draft -> approval -> send).

Exec
- Default host for local work: `node`.
- Gateway host only for safe ops tasks (status, logs, audits).
- Sandbox host for experiments.

Redaction
- Never log tokens, credentials, or private client data.
