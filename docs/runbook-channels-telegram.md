# Runbook: Telegram Channel (Fallback)

PLACEHOLDERS (set these before running commands)
- TELEGRAM_BOT_TOKEN=PLACEHOLDER_TELEGRAM_BOT_TOKEN
- TELEGRAM_ALLOWED_USERS=PLACEHOLDER_TELEGRAM_ALLOWED_USERS_CSV
- TELEGRAM_ALLOWED_GROUP_ID=PLACEHOLDER_TELEGRAM_GROUP_ID

Goal
- Connect OpenClaw to Telegram in pairing/allowlist mode.

Steps
1) Create a Telegram bot
- Use BotFather to create a bot and obtain the token.
- Store the token in env vars or a local secret file (never commit).

2) Configure OpenClaw
- Edit `data/openclaw/openclaw.json`:
  - `channels.telegram.enabled` -> `true`
  - `channels.telegram.botToken` -> your bot token (or use `TELEGRAM_BOT_TOKEN` env and omit botToken)
  - `channels.telegram.dmPolicy` -> `pairing` (or `allowlist`)
  - `channels.telegram.allowFrom` -> list of allowed user ids / usernames
  - `channels.telegram.groups.<groupId>.requireMention` -> `true`

3) Restart gateway and verify
- `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`
- Send a DM and confirm pairing approval + draft-first behavior.

Notes
- Use polling (default) unless you explicitly need webhooks.
- Keep allowlists tight and require explicit approvals for outbound messages.
