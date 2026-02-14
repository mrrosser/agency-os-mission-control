# Runbook: ElevenLabs (Voice)

Placeholders
- `ELEVENLABS_API_KEY=PLACEHOLDER`
- `ELEVENLABS_VOICE_ID=PLACEHOLDER`
- `ELEVENLABS_MODEL_ID=PLACEHOLDER`

Goal
- Enable approved voice generation via `/api/elevenlabs/synthesize`.
- Keep generation draft-first and traceable with correlation IDs.

UI entry points
- API Vault: `/dashboard/settings?tab=integrations`
- Integrations test page: `/dashboard/integrations`
- Operations control: `/dashboard/operations`

## Setup (Mission Control app path)

1) Store secret in Settings
- Open `Dashboard -> Settings -> API Keys`.
- Set `ElevenLabs API Key`.
- Save and verify configured status.

2) Choose defaults for calls
- Default voice/model are accepted by the route if omitted:
  - voice: `21m00Tcm4TlvDq8ikWAM`
  - model: `eleven_monolingual_v1`
- For business-specific tone, pass explicit `voiceId`/`modelId` from your voice packs.

3) Run smoke tests
- `npm test -- tests/smoke/elevenlabs-route.test.ts`
- Expected:
  - missing key path returns `400`
  - success path returns `audioBase64`, `mimeType=audio/mpeg`, and logs activity

4) Runtime verification
- From authenticated app session, call `POST /api/elevenlabs/synthesize` with:
  - `text` (required)
  - `voiceId` (optional)
  - `modelId` (optional)
- Confirm response includes:
  - `success: true`
  - `audioBase64`
  - `voiceId`

5) Twilio live-call path (true ElevenLabs playback)
- `POST /api/twilio/make-call` now supports:
  - `to` + `text` (+ optional `businessKey`, `voiceId`, `modelId`)
- Flow:
  1. synthesize ElevenLabs MP3
  2. host temporary audio at `/api/public/call-audio/{clipId}`
  3. call via Twilio `<Play>` using that URL
- Optional per-business voice defaults via env:
  - `ELEVENLABS_VOICE_ID_AICF`
  - `ELEVENLABS_VOICE_ID_RNG`
  - `ELEVENLABS_VOICE_ID_RTS`

## Optional OpenClaw VM TTS path

If you later route TTS through native OpenClaw on VM:
- Set `messages.tts.provider=elevenlabs`
- Keep `messages.tts.auto=tagged` (safe default)
- Keep API key in env/secret manager, never in checked-in config.

Notes
- Do not synthesize or publish without explicit approval.
- Keep text free of sensitive data and private PII.
