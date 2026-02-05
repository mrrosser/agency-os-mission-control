# Runbook: Twilio (Voice + SMS)

PLACEHOLDERS (set these before running commands)
- TWILIO_ACCOUNT_SID=PLACEHOLDER
- TWILIO_AUTH_TOKEN=PLACEHOLDER
- TWILIO_FROM_NUMBER=PLACEHOLDER_E164_NUMBER
- TWILIO_TO_NUMBER=PLACEHOLDER_E164_NUMBER
- TWILIO_PUBLIC_WEBHOOK_URL=PLACEHOLDER_PUBLIC_URL

Goal
- Enable Twilio voice calls with strict approval gates and minimal privileges.
- SMS is supported via Twilio API (use MCP/skill or manual approval flow).

Setup (Voice Calls via OpenClaw plugin)
1) Create a Twilio API key + secret
- Store in env vars or Secret Manager only.

2) Configure voice-call plugin
- Edit `data/openclaw/openclaw.json`:
  - `plugins.entries.voice-call.enabled` -> `true`
  - `plugins.entries.voice-call.config.provider` -> `twilio`
  - `plugins.entries.voice-call.config.fromNumber` -> your Twilio number
  - `plugins.entries.voice-call.config.toNumber` -> your number for test calls
  - `plugins.entries.voice-call.config.twilio.accountSid` -> TWILIO_ACCOUNT_SID
  - `plugins.entries.voice-call.config.twilio.authToken` -> TWILIO_AUTH_TOKEN
  - `plugins.entries.voice-call.config.serve.path` -> `/voice/webhook`
  - Set a public webhook URL using Tailscale Funnel or a reverse proxy

3) Set Twilio webhook
- In Twilio Console, set the Voice webhook to your public URL + `/voice/webhook`.

4) Restart gateway and verify
- `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`

SMS (Twilio API)
- SMS is not a built-in OpenClaw channel.
- Use a Twilio MCP server or a custom skill that calls the Twilio Messaging API.
- Keep SMS outbound draft-only and approval-gated.

Notes
- Keep inbound webhooks restricted to a single path only.
- Do not send messages or place calls without explicit approval.
