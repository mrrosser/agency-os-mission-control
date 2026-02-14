# OpenClaw Business Pack Gap Report

Last updated: 2026-02-12
Owner: Mission Control
Scope: AI CoFoundry, RT Solutions, Rosser NFT Gallery

## Current State

- Gmail triage is running for all four inboxes on the VM.
- Autosync is healthy and running on timer.
- Draft-first behavior is active, but draft creation is conservative (many threads are searched but skipped).
- Current `OpenClaw_KnowledgePack_AICoFoundry_TNRTSolutions_v1.json` includes AI CoFoundry + RT Solutions only.
- New repo templates now exist for:
  - `please-review/from-root/config-templates/knowledge-pack.v2.json`
  - `please-review/from-root/config-templates/email-triage.policy.v2.json`
  - `please-review/from-root/config-templates/email-reply-templates.v1.json`

## Closed Gaps (Implemented)

1. Added Rosser NFT Gallery as a first-class business object in v2 pack.
2. Added explicit approval matrix (draft-first, manual send, strict calendar auto-book).
3. Added mailbox-to-business routing map and deterministic keyword routing.
4. Added do-not-draft suppression policy and confidence thresholds.
5. Added strict calendar policy object with free/busy + conflict fallback.
6. Added business-specific reply template bank so all drafts do not sound the same.
7. Added Marcus voice-pack guardrails (no robotic phrasing, concise structure, brand tone overlays).
8. Added explicit business calendar profile mapping so each business can use its own booking flow.

## Critical Gaps (Must Fill First)

1. Canonical identity conflicts still unresolved
- AICF emails differ across sources (`marcus@aicofoundry.com` vs `mrosser@aicofoundry.com`).
- RT Solutions has unresolved naming (RT Solutions vs Tennessee RT Solutions) and public footprint ambiguity.
- Action: pick one canonical legal + operating identity per business and lock it in pack metadata.

2. Missing machine-usable ownership map
- Need explicit owner by function: sales, delivery, finance, legal/compliance for each business.
- Action: add `ownersByFunction` object to the pack.

3. Missing CRM source-of-truth configuration
- Current operations use Sheets; no canonical CRM API system is configured.
- Action: lock one system now (Sheets schema first, HubSpot later) and map stage IDs.

4. Missing Drive/Chat indexing policy for contextual drafting
- Need defined folders to ingest and exclude, plus max token budget for context snippets.
- Action: add `knowledgeIngestionPolicy` with allowed sources and ranking.

5. Missing payment/finance integration contract
- RT Solutions + Rosser NFT Gallery use Square; AICF billing ownership differs.
- Action: define what actions are read-only vs write and who approves payment events.

## Important Gaps (Second Wave)

6. Missing pricing object normalization
- Current pack contains narrative pricing but not machine-safe structure.
- Add normalized fields:
  - `currency`
  - `price_model` (`fixed`, `range`, `retainer`, `custom`)
  - `min_price`
  - `max_price`
  - `quote_required` boolean

7. Missing source-of-truth IDs for systems
- Define canonical IDs or URLs for:
  - CRM record location
  - calendar ids
  - Drive folder roots
  - Square account mapping
  - social account handles

8. Missing audit metadata
- Add:
  - `pack_version`
  - `changed_by`
  - `changed_at`
  - `review_due_at`
  - `confidence` per fact (`public_verified`, `internal_verified`, `unverified`)

## CRM Decision (Pragmatic Recommendation)

- You do not need a heavy CRM immediately, but you do need a single source of truth for pipeline state.
- Recommended now:
  - Keep Google Sheets as operational ledger (fastest).
  - Enforce strict schema (no free-form columns).
  - Sync to HubSpot Free later only when lead volume or team handoffs require it.

Minimum schema now:
- `lead_id`, `business`, `source`, `contact_name`, `email`, `phone`, `stage`,
  `owner`, `next_action`, `next_action_due`, `value_estimate`, `last_touch_at`,
  `status`, `notes`.

## Twilio + Voice Readiness

- Twilio SMS/call secret handling now requires and supports:
  - SID
  - auth token
  - default Twilio phone number (`TWILIO_PHONE_NUMBER`)
- Outbound call quality path with ElevenLabs still needs one production decision:
  - host synthesized audio at a public URL for Twilio `<Play>`, or
  - switch to Twilio `<Say>` for immediate live calling.

## Immediate Execution Order

1. Publish v2 knowledge pack with RNG included and full routing/approval/calendar policies.
2. Tighten triage with do-not-draft suppression and intent thresholds.
3. Keep send as manual approval; keep calendar auto-booking for explicit meeting intents.
4. Lock minimal CRM sheet schema and enforce it across all 3 businesses.
