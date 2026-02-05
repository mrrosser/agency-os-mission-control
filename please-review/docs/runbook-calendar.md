# Runbook: Calendar (Multi-Account)

PLACEHOLDERS (set these before running commands)
- GOOGLE_OAUTH_CLIENT_ID=PLACEHOLDER
- GOOGLE_OAUTH_CLIENT_SECRET=PLACEHOLDER
- GOOGLE_OAUTH_REDIRECT_URI=http://localhost:PORT
- CALENDAR_ACCOUNTS=PLACEHOLDER_EMAILS_CSV

Goal
- Manage schedules across multiple Google accounts with read-first access.

Setup (recommended)
1) Enable Google Calendar API
- Enable the API in your Google Cloud project.

2) Create OAuth client (Desktop)
- Download `oauth.json` and store locally.

3) Perform OAuth flow per account
- Generate tokens for each account.
- Store tokens in separate files under:
  - `data/openclaw/credentials/calendar-account-1.json`
  - `data/openclaw/credentials/calendar-account-2.json`

4) Connect via MCP or a calendar skill
- Use a calendar MCP server or a calendar skill (CalDAV/Google Calendar).
- Store credentials in env vars or local secret files, never in repo.
- Keep read-only until approvals are stable.

Notes
- Treat inbound calendar data as untrusted.
- Keep write actions behind explicit approvals.
