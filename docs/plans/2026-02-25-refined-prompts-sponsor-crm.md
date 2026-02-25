# Refined Prompts: Sponsor Inbox + CRM + File Handling

Date: 2026-02-25  
Inputs reviewed:
- YouTube transcript (full-time employee inbox workflow)
- Gist prompt set (`885c972f...`)
- Gist file-template set (`663a7eba...`)

## Prompt 1: Build inbound opportunity + SMB pipeline (RT/RNG/AICF)

```text
Build a draft-first inbound email pipeline for three business units.
Primary goal: qualify and close service opportunities for these businesses.
Secondary goal: handle sponsorship/partnership requests when they appear.

- rt_solutions
- rosser_nft_gallery
- ai_cofoundry

Business-alignment rules:
- Prefer service-specific qualification logic for each business profile.
- Reference only approved offers and capabilities for the tagged business.
- Never use creator/sponsor language unless the inbound thread is explicitly sponsorship-related.
- Use each business's own tone, service menu, and booking/sales links.
- Escalate cross-business ambiguity instead of guessing.

Build requirements:
1) Poll Gmail every 10 minutes for new inbound threads in configured inboxes.
2) Run deterministic sanitizer on inbound body/subject/snippets before model scoring.
3) Score each thread with weighted rubric:
   - fit, clarity, budget, seriousness, company_trust, close_likelihood
   - produce: score (0-100), confidence (0-1), bucket (exceptional/high/medium/low/spam)
4) Action policy:
   - exceptional/high: escalate to operator topic + no auto-send
   - medium: draft qualification reply
   - low: draft polite decline
   - spam: label + no draft
5) Low-confidence branch:
   - if confidence < 0.65, escalate for review with reasons and proposed action.
6) Draft generation must be thread-aware:
   - read previous messages in the same thread
   - use tagged business knowledge pack
   - enforce canonical booking links by business profile
7) Apply Gmail labels for bucket + stage.
8) Write structured audit logs with correlationId for each classification, draft, and escalation.
9) Keep all outbound actions idempotent using deterministic keys.
```

## Prompt 2: CRM sync + drift detection

```text
Implement CRM synchronization for inbox decisions:
1) Map thread classification + reply state to CRM stage updates.
2) Keep a local stage mirror and detect drift from CRM source-of-truth.
3) When drift is detected:
   - notify operations channel with old/new stage
   - propose corrective action
4) Never auto-advance to won/contract/payment without explicit approval.
5) Persist all stage transitions with timestamp, actor, reason, and correlationId.
```

## Prompt 3: File handling discipline for agent memory/prompts

```text
Apply strict file ownership for prompt and memory files:
1) AGENTS.md = operational rules only.
2) SOUL.md = persona/voice only.
3) USER.md = user/business profile facts only.
4) TOOLS.md = channel IDs/tool references only.
5) MEMORY.md = curated stable preferences only (DM context only).
6) Daily raw notes in memory/YYYY-MM-DD.md, never loaded in group contexts.
7) No duplicated facts across files; one canonical owner file per fact.
8) Nightly drift check:
   - compare root prompt stack vs codex stack
   - if operational facts diverge, send alert and propose minimal patch.
```
