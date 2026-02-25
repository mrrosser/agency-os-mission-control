# Model Prompting Guidance (Downloaded + Curated)

Date refreshed: 2026-02-25

## Purpose
- Keep one repo-local source for model-specific prompting rules used by this system.
- Prevent prompt drift across providers and agent stacks.
- Support dual prompt stacks (`root/` for primary model, `codex/` for coding model) with shared operational facts.

## Sources (official)
- OpenAI Cookbook: GPT-5 prompt optimization cookbook
- OpenAI Cookbook: GPT-5.1 prompting guide
- OpenAI: Codex operating guide
- Google AI for Developers: Gemini prompt design strategies
- Anthropic docs: prompt engineering overview

See `docs/model-guidance/sources.md` for URLs.

## Files
- `docs/model-guidance/openai-gpt-codex.md`
- `docs/model-guidance/google-gemini.md`
- `docs/model-guidance/anthropic-claude.md`
- `docs/model-guidance/shared-cross-model-checklist.md`

## Operational rule
- Keep business facts identical across prompt stacks.
- Apply provider-specific style rules only in model-specific sections.
- Run nightly drift checks and alert on operational-fact divergence.
