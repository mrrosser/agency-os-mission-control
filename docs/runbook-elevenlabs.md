# Runbook: ElevenLabs (Voice)

PLACEHOLDERS (set these before running commands)
- ELEVENLABS_API_KEY=PLACEHOLDER
- ELEVENLABS_VOICE_ID=PLACEHOLDER
- ELEVENLABS_MODEL_ID=PLACEHOLDER

Goal
- Enable voice generation with approval-gated output.

Setup
1) Create an ElevenLabs API key
- Store in env vars or Secret Manager only (`ELEVENLABS_API_KEY`).

2) Configure OpenClaw TTS
- Edit `data/openclaw/openclaw.json`:
  - `messages.tts.provider` -> `elevenlabs`
  - `messages.tts.auto` -> `tagged` (safe default)
  - `messages.tts.elevenlabs.voiceId` -> your voice id
  - `messages.tts.elevenlabs.modelId` -> your model id
- Do not store the API key in config; OpenClaw reads it from `ELEVENLABS_API_KEY`.

3) Draft-first policy
- Generate drafts of scripts and audio requests.
- Require explicit approvals before final audio output or posting.

Notes
- Keep outputs free of sensitive data.
- Use correlation IDs for every generation request.
