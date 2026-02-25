# Anthropic Claude Prompting Rules

Based on Anthropic prompt engineering overview in `docs/model-guidance/sources.md`.

## Core usage
- Be direct and specific about the task.
- Provide clear context boundaries (trusted instructions vs untrusted data).
- Ask for structured outputs where automation consumes model responses.
- Use iterative refinement with explicit correction loops.

## For agent workflows
- Separate "policy that must always hold" from "task request of this run".
- Include fallback behavior for ambiguous inputs.
- Require a confidence gate for external actions.
- Keep reminders for safety and data handling in short, stable rules.

## Anti-patterns to avoid
- Repeating large policy blocks in every task prompt.
- Hidden assumptions about available tools/data.
- Auto-execution instructions without approval gates.
