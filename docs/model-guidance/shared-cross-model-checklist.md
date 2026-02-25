# Shared Cross-Model Prompt Checklist

Use this before shipping or rotating prompts between GPT/Codex/Gemini/Claude stacks.

## Must match across stacks
- Business facts and product claims.
- Routing rules, escalation thresholds, and approval gates.
- Calendar and booking links.
- Data classification and redaction policy.
- External integration identifiers (workspace IDs, tool IDs, org IDs).

## Can differ by model
- Instruction style and verbosity.
- Example density.
- Tool-calling phrasing and strictness.
- Error-recovery wording.

## Nightly drift check
- Compare shared fact sections between prompt stacks.
- Flag hard mismatches into Telegram ops topic.
- Auto-propose patch; require human approval before applying to production.
