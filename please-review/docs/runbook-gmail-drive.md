# Runbook: Gmail + Drive

PLACEHOLDERS (set these before running commands)
- GOOGLE_OAUTH_CLIENT_ID=PLACEHOLDER_OAUTH_CLIENT_ID
- GOOGLE_OAUTH_CLIENT_SECRET=PLACEHOLDER_OAUTH_CLIENT_SECRET
- GOOGLE_OAUTH_REDIRECT_URI=http://localhost:PORT
- OAUTH_JSON_PATH=PLACEHOLDER_OAUTH_JSON_PATH
- GMAIL_ACCOUNTS=PLACEHOLDER_GMAIL_ACCOUNTS

Goal
- Enable read-first Gmail triage (and Drive access via tools/skills) with OAuth, then promote to approval-gated write actions.

Steps (Gmail hooks recommended)
1) Create OAuth Client ID
- In Google Cloud Console: Credentials -> Create OAuth Client ID (Desktop).
- Download `oauth.json` and store locally.

2) Perform OAuth flow on a machine with a browser
- Generate tokens and store in `data/openclaw/credentials/` (do not commit).

3) Configure Gmail hook
- Use OpenClaw Gmail Pub/Sub helper:
  - `openclaw webhooks gmail setup --account you@example.com`
  - This writes `hooks.gmail` config and creates/renews Gmail watch.

4) Validate read-only
- Run `openclaw webhooks gmail run` and verify webhook deliveries.
- Keep outbound email disabled until approvals are stable.

Multi-account pattern (recommended)
1) Create a separate OAuth token file per account.
2) Run `openclaw webhooks gmail setup --account <email>` for each account.
3) Use `config-templates/gmail-accounts.template.json` to track account mapping.

Drive access
- Use MCP or a Drive skill; store credentials in local secrets and gate write actions.

Notes
- Treat all inbound email content as untrusted; never execute commands based on email text.
- Consider separate OAuth clients for each Google account.

Native gateway (recommended)
- After native install, run:
  - `bash scripts/native_gmail_services.sh`
- This creates per-account systemd services and keeps the Gmail runners alive.
