# ExecPlan: Voice + Sub-Agent Orchestration (OpenClaw)

Date: 2026-02-16

## Goal
Make the phone system production-usable by routing calls through a master orchestrator, grounding responses in business knowledge, and enabling safe operational actions (draft email + calendar invite + CRM upsert).

## Non-Goals
- Auto-sending outbound emails from calls.
- Autonomous contract/pricing/payment commitments.
- Replacing existing Gmail triage policies.

## Design
- Add an explicit `agentTopology` in the business pack:
  - `orchestrator` as the entrypoint.
  - Business specialists: `biz_aicf`, `biz_rng`, `biz_rts`.
  - Functional specialists: `fn_marketing`, `fn_research`.
  - Single write executor: `fn_actions`.
- Add deterministic handoff triggers by business keywords and action intents.
- Add `knowledgeIngestionPolicy`:
  - metadata-delta weekly scan.
  - thread-first context, then Drive/Calendar/Chat snippets.
  - scoped Drive roots per business/account.
- Add `voiceOpsPolicy`:
  - require business context before writes.
  - require thread lookup before drafting emails.
  - keep send as manual approval.
  - enforce Google Meet + timezone in calendar actions.
- Update OpenClaw config templates with:
  - agent list/routing block.
  - voice runtime block for knowledge + action-tool policy.

## Definition of Done
- Knowledge pack contains `agentTopology`, `knowledgeIngestionPolicy`, and `voiceOpsPolicy`.
- OpenClaw templates define sub-agents and routing triggers.
- Voice runtime templates include action guardrails and knowledge pack bindings.
- Unit test coverage validates required keys and selected values.

## Local Verification
- Run targeted tests:
  - `npm test -- tests/unit/openclaw-business-pack.test.ts`
- Sanity-check generated template JSON files:
  - `please-review/from-root/config-templates/knowledge-pack.v2.json`
  - `please-review/from-root/config-templates/openclaw.json.template`
  - `please-review/from-root/config-templates/openclaw.json.write.template`

## Deploy / Apply (Gateway)
1. Copy updated templates to the gateway host (or merge into existing live config).
2. Update `/home/marcu/.openclaw/openclaw.json` with:
   - `agents.list`
   - `agents.routing`
   - `plugins.entries.voice-call.config.runtime`
3. Update `/etc/openclaw/knowledge-packs/knowledge-pack.v2.json` with the new policy blocks.
4. Restart gateway:
   - `sudo systemctl restart openclaw-gateway.service`
5. Validate:
   - `openclaw gateway call status --url ws://127.0.0.1:18789 --json`
   - place inbound call test and verify: business-aware response + draft creation + calendar invite guardrails.

## Rollback
- Restore previous `openclaw.json` and `knowledge-pack.v2.json` from backup.
- Restart gateway service.
