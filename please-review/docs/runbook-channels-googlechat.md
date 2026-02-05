# Runbook: Google Chat Channel

PLACEHOLDERS (set these before running commands)
- GOOGLE_CHAT_SERVICE_ACCOUNT_FILE=PLACEHOLDER_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE_PATH
- GOOGLE_CHAT_AUDIENCE=PLACEHOLDER_GOOGLE_CHAT_AUDIENCE
- GOOGLE_CHAT_WEBHOOK_PATH=/googlechat
- GOOGLE_CHAT_DM_ALLOWLIST=PLACEHOLDER_USER_IDS_OR_EMAILS_CSV
- GOOGLE_CHAT_SPACE_ID=spaces/AAQAJt-QD1I
- GOOGLE_CHAT_BOT_USER=users/mcool44
- GATEWAY_PUBLIC_URL=PLACEHOLDER_PUBLIC_WEBHOOK_URL

Goal
- Connect OpenClaw to Google Chat using a service account and a narrow webhook path.

Steps
1) Enable Google Chat API in the project
- In GCP Console: APIs & Services -> Enable Google Chat API.

2) Create a service account
- Create a service account and download its JSON key file.
- Store the JSON key securely (do not commit).

3) Configure the webhook path
- Use `/googlechat` only; do not expose the whole gateway.
- If you need a public webhook, use Tailscale Funnel on the specific path only.

4) Update OpenClaw config
- Edit `data/openclaw/openclaw.json`:
  - `channels.googlechat.enabled` -> `true`
  - `channels.googlechat.serviceAccountFile` -> path to service account JSON
  - `channels.googlechat.audienceType` -> `app-url`
  - `channels.googlechat.audience` -> Google Chat audience string
  - `channels.googlechat.webhookPath` -> `/googlechat`
  - `channels.googlechat.botUser` -> `users/<id>` (optional, improves mention detection)
  - `channels.googlechat.dm.policy` -> `pairing` (or `allowlist`)
  - `channels.googlechat.dm.allowFrom` -> list of allowed users/emails
  - `channels.googlechat.groupPolicy` -> `allowlist`
  - `channels.googlechat.groups.<spaceId>.allow` -> `true`
  - `channels.googlechat.groups.<spaceId>.requireMention` -> `true`

5) Restart gateway and verify
- `docker compose -f docker/docker-compose.yml --env-file docker/.env restart`
- Send a DM and confirm pairing approval + draft-first behavior.

Helper: wire the service account JSON on the VM
- Copy the JSON to the VM (example):
  - `gcloud compute scp /path/to/openclaw-googlechat-sa.json ai-hell-mary-gateway:~/ --zone us-central1-a`
- On the VM:
  - `SA_JSON_SRC=~/openclaw-googlechat-sa.json ENABLE_GOOGLECHAT=true bash scripts/wire_googlechat_sa.sh`

Fallback
- If Google Chat is blocked by Workspace policy, use Telegram first (see `docs/runbook-channels-telegram.md`).

Notes
- Never allow public posting without explicit approval.
- Keep the DM and group allowlists tight.
- If an incoming webhook URL was shared, rotate the token and store it only in local secrets (never in repo files).

