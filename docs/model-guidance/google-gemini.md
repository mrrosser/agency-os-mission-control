# Google Gemini Prompting Rules

Based on the Gemini prompt strategy source in `docs/model-guidance/sources.md`.

## Structure
- Lead with task intent and desired output format.
- Use examples when precision is needed.
- Add explicit grounding instructions for retrieval outputs (cite source IDs/links).
- Keep instructions composable: role, task, format, constraints.

## Reasoning + extraction tasks
- Ask for concise reasoning summaries, not long hidden chain-of-thought.
- Request confidence or uncertainty markers on classification outputs.
- Provide reject conditions for unsafe or low-confidence actions.

## Tool-integrated use
- Explicitly define when Gemini should call a tool versus answer directly.
- Require deterministic parsing targets for downstream systems.
- Enforce redaction policy in prompt contract for shared channels.

## Anti-patterns to avoid
- Overly broad prompts without guardrails.
- Implicit output formats for automation steps.
- Missing low-confidence branch behavior.
