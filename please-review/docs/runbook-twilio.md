# Runbook: Twilio (Voice + SMS)

Placeholders
- `TWILIO_ACCOUNT_SID=PLACEHOLDER`
- `TWILIO_AUTH_TOKEN=PLACEHOLDER`
- `TWILIO_PHONE_NUMBER=PLACEHOLDER_E164_NUMBER`
- `TEST_TO_NUMBER=PLACEHOLDER_E164_NUMBER`

Goal
- Enable Twilio SMS + voice in Mission Control (`/api/twilio/send-sms`, `/api/twilio/make-call`).
- Keep outbound actions approval-gated and idempotent.

UI entry points
- API Vault: `/dashboard/settings?tab=integrations`
- Integrations test page: `/dashboard/integrations`
- Operations control: `/dashboard/operations`

## Path A: Mission Control app (current production path)

1) Store secrets in Settings
- Open `Dashboard -> Settings -> API Keys`.
- Set:
  - Twilio Account SID
  - Twilio Auth Token
  - Twilio Phone Number (E.164 format, example `+15005550006`)
- Save and verify badges show configured.

2) Local smoke (code-level)
- Run:
  - `npm test -- tests/smoke/twilio-routes.test.ts`
- Expected:
  - all tests pass
  - idempotency + correlation logging is present in test output

3) API smoke (runtime)
- Trigger from the Operations UI in app (recommended), or call APIs with an authenticated session:
  - `POST /api/twilio/send-sms`
  - `POST /api/twilio/make-call`
- Required payload fields:
  - SMS: `to`, `message`
  - Call: `to`, plus either:
    - `audioUrl` (pre-hosted MP3), or
    - `text` (auto-synthesize with ElevenLabs, host clip, then Twilio `<Play>`)
- `from` is optional and falls back to stored `TWILIO_PHONE_NUMBER`.

4) Production verification checklist
- Verify the target receives:
  - one SMS
  - one call with audio playback
- Confirm no duplicate sends on retry (idempotency key behavior).
- Confirm logs include:
  - `twilio.sms.send`
  - `twilio.call.create`

## Path B: Optional OpenClaw VM voice-call plugin (native gateway)

Use only if you want Twilio webhooks handled directly on the VM.

1) Configure plugin in VM OpenClaw config
- `plugins.entries.voice-call.enabled=true`
- `plugins.entries.voice-call.config.provider=twilio`
- `plugins.entries.voice-call.config.twilio.accountSid=TWILIO_ACCOUNT_SID`
- `plugins.entries.voice-call.config.twilio.authToken=TWILIO_AUTH_TOKEN`
- `plugins.entries.voice-call.config.fromNumber=TWILIO_PHONE_NUMBER`
- `plugins.entries.voice-call.config.serve.path=/voice/webhook`

2) Set webhook in Twilio Console
- Voice webhook URL: `<public-url>/voice/webhook`
- Restrict to that single path.

3) Restart and inspect on VM
- `sudo systemctl restart openclaw-gateway.service`
- `sudo journalctl -u openclaw-gateway.service -n 200 --no-pager`

Notes
- Do not hardcode secrets in repo files.
- Keep outbound SMS/call actions behind explicit approval until confidence is high.
