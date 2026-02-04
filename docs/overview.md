# Overview

This repo deploys OpenClaw as an always-on assistant using a hybrid topology:

1) Gateway (GCP VM, native recommended)
- Always-on brain, runs tools and integrations.
- Bound to loopback; reachable via SSH tunnel or Tailscale Serve.
- Stores state in `data/openclaw` and `data/openclaw/workspace`.

2) Node Host (Windows + WSL2)
- Executes local coding tasks and local tools.
- Connects to the gateway over an SSH tunnel or tailnet.
- Uses a strict exec approvals allowlist.

High-level flow:

[Google Chat or Telegram]
        |
        v
[OpenClaw Gateway (GCE VM)] <---- SSH tunnel / Tailscale ----> [OpenClaw Node (Windows/WSL2)]
        |
        v
[Hook/MCP/CLI integrations: Gmail hooks, GitHub CLI, Cloud Run via gcloud]

Security boundary:
- Gateway is not publicly exposed except a single webhook path if required (e.g., /googlechat).
- All inbound content is treated as untrusted; no tool or exec action without explicit approval.
- Stop switch disables outbound messaging and exec by policy (channels disabled + tools.deny).

Revenue-first behaviors:
- Draft outreach and quotes first; never auto-send.
- Prioritize lead pipeline, booking, deposits, and follow-ups.
- Maintain a single source of truth for services/pricing and lead status.

Key repo areas:
- `docs/runbook-gcp-gateway-native.md`: native install (recommended for stability).
- `docker/`: Dockerfile and compose for gateway.
- `config-templates/`: gateway config and exec approvals templates.
- `openclaw-workspace-template/`: agent behavior and memory templates.
- `docs/runbook-*.md`: step-by-step setup.
- `docs/runbook-playwright.md`: web automation setup.
- `docs/runbook-web-browsing.md`: safe browsing policies.
- `docs/runbook-skills.md`: import global skills.
- `docs/runbook-mcp-integrations.md`: MCP env placeholders.
- `docs/runbook-social-networks.md`: untrusted social networks policy.
- `docs/runbook-twilio.md`: SMS + voice runbook.
- `docs/runbook-elevenlabs.md`: voice generation runbook.
- `docs/runbook-calendar.md`: calendar integration (multi-account).
- `docs/runbook-github-automation.md`: repo create/push runbook.
- `docs/runbook-context7.md`: Context7 MCP server.
- `docs/runbook-firestore.md`: Firestore integration.
- `docs/runbook-google-workspace.md`: Workspace APIs.
- `docs/runbook-write-mode.md`: enable write mode with approvals.
