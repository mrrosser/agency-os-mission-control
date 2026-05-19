---
name: lead-comms-email-thread-guardrails
description: Thread-priority rules for mission-control email drafting. Use when replies must anchor to the newest inbound ask, ignore quoted thread noise, avoid cross-thread bleed, and ask only one focused blocker question when context is incomplete.
---

# Lead Comms Email Thread Guardrails

## When to use
- An email reply should continue an active thread.
- Older quoted content could distract the model from the newest inbound ask.

## Workflow
1. Resolve the newest inbound ask first.
2. Treat quoted history and signatures as support only.
3. Avoid carrying facts from other threads unless the current thread quotes them.
4. Ask one blocker question only when needed to move the thread forward safely.

## Verification
- [ ] Newest ask is answered directly.
- [ ] Thread noise is not treated as the main task.
- [ ] Only one blocker question appears when required.

## Example prompts
- "Use lead-comms-email-thread-guardrails before composing this reply."
- "Apply lead-comms-email-thread-guardrails and tell me if the reply should ask a blocker question."
