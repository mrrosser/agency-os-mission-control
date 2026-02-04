# Cost + Performance Tuning (OpenClaw)

Goal
- Keep the assistant responsive without burning budget on background loops.
- Use high-end models only for tasks that benefit from them.

Recommended Routing (aligned to current model aliases)
1) Brain (general orchestration)
- Preferred: GPT-5 (with reasoning effort set to high)
- If a GPT-5.2 model ever appears in your /v1/models, you can prefer it, but it is not listed in current OpenAI docs.
- Default fallback: `openai/gpt-5` (alias: `brain`)
- Cheaper alt: `openai/gpt-5-mini` (alias: `brain-fast`)

2) Heartbeat (background checks)
- Use the cheapest reliable model: `brain-fast` or `gemini-lite`
- Interval: 60 minutes (or 30 if you need tighter responsiveness)

3) Coding/infra tasks
- Use Codex for coding and CLI tasks: `openai-codex/gpt-5-codex` (alias: `codex`)
- Cheaper alt: `openai-codex/codex-mini-latest` (alias: `codex-fast`)

4) Outreach/content
- Use Gemini for warm drafts: `google/gemini-2.5-pro` (alias: `gemini`)
- Use `gemini-fast` for quick drafts and summaries

5) Web browsing + image understanding
- Use `gemini-fast` (lower cost, strong for extraction)

How to apply in OpenClaw UI
1) Open the OpenClaw Control UI.
2) Set:
   - Default model: `brain`
   - Coding tasks: `codex`
   - Outreach tasks: `gemini`
   - Heartbeat model: `brain-fast` or `gemini-lite`
   - Heartbeat interval: 60 minutes
3) Save + restart gateway if required.

Notes
- Avoid expensive models for scheduled/background tasks.
- If you see cost spikes, reduce heartbeat frequency first.

Verified Model IDs (external docs)
- OpenAI (core): `gpt-5`, `gpt-5-mini`, `gpt-5-nano`
- OpenAI (Codex): `gpt-5-codex`, `codex-mini-latest`
- Google: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`
