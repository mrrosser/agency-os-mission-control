# OpenAI GPT + Codex Prompting Rules

Based on the sources listed in `docs/model-guidance/sources.md`.

## GPT orchestration prompts
- Put goal, constraints, and success criteria at the top.
- Give exact output schema (JSON keys, table columns, or fixed sections).
- Use explicit tool-use policy: when to call tools, when to ask, when to stop.
- Separate immutable policy facts from mutable task context.
- For long tasks, request checkpointed output (`plan`, `execute`, `verify`).

## Codex coding prompts
- Scope tightly: one task, one expected artifact set.
- Require evidence before completion claims (`tests run`, command output, file list).
- Prefer small diffs and idempotent external side effects.
- Include failure handling rules for shell/API calls.
- Ask for deterministic logging and correlation IDs on service/tool actions.

## Required sections in system prompts
- `Objective`
- `Hard Constraints`
- `Allowed Tools`
- `Output Contract`
- `Verification Gate`
- `Stop Conditions`

## Anti-patterns to avoid
- Vague prompts without output contract.
- Mixing policy and one-off task details in the same block.
- Unbounded "improve everything" instructions without DoD.
