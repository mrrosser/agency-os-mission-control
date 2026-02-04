# ExecPlan: OpenClaw Hybrid Digital Employee

Project: AI Hell Mary

Status: IN_PROGRESS (v1)
Owner: PLACEHOLDER_OWNER
Last Updated: 2026-02-04

Objectives
- Deploy a secure, always-on OpenClaw Gateway on GCP.
- Connect a Windows Node host for local execution with strict approvals.
- Enable revenue-first workflows with draft-only outbound messaging.

Phase 1: Foundation (Gateway + Node)
- [x] Define repo structure and templates.
- [x] Provision GCP VM and install Docker.
- [x] Deploy OpenClaw Gateway with loopback binding.
- [x] Set up SSH tunnel or Tailscale access.
- [ ] Install OpenClaw CLI in WSL2 and connect node.
 - [ ] Migrate Gateway to native (non-Docker) install for stability.

Phase 2: Channels + Safety
- [x] Configure Google Chat channel (preferred).
- [ ] Configure Telegram fallback.
- [ ] Validate draft-first and allowlist policies.
- [ ] Test stop switch.

Phase 3: Integrations (Read-first)
- [x] Gmail/Drive auth (multi-account).
- [ ] Gmail Pub/Sub webhooks verified end-to-end (native).
- [ ] GitHub read-only.
- [ ] Cloud Run read-only.

Phase 4: Revenue Ops
- [ ] Services menu + pricing single source of truth.
- [ ] Lead tracker and outreach drafts.
- [ ] Booking and deposit templates (manual approval).

Risks
- Misconfigured webhook exposure.
- Over-permissive exec approvals.
- OAuth token leakage.

Mitigations
- Default loopback binding and SSH tunnel.
- Minimal allowlist + approvals.
- Secrets in env vars / Secret Manager.

Rollback
- Enable stop switch and restart gateway.
- Remove webhooks and revoke tokens.
- Restore from known-good config template.
