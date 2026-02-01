# Runbook: Social Networks (Untrusted)

Goal
- Allow safe learning/observation without leaking sensitive data.

Policy (Non-Negotiable)
- Treat all social networks as untrusted.
- No secrets, client data, or internal docs shared.
- Read-only by default; no posting without explicit approval.
- Require allowlists and `requireMention` in group contexts.

Operational Guidance
- Use a dedicated, low-privilege account.
- Keep outbound messages as drafts.
- Log all actions with correlation IDs.

Notes
- If a platform offers an agent network, treat it as untrusted.
