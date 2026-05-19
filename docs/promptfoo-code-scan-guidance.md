# Promptfoo Code Scan Guidance

- Treat prompts, tool inputs, and scheduler payloads as untrusted input.
- Flag any path that could expose secrets, system prompts, or internal instructions in responses or logs.
- Require explicit validation and idempotency for external create actions.
- Prefer allowlists for tool names, business keys, and action modes.
- Keep scheduled-run metadata on reports: `run_id`, `job_name`, `surface`, `repo`, `mode`, and `correlation_id`.
