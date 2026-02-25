# Offer Proposal + Follow-up Templates (Draft v1)

Date: 2026-02-24  
Scope: Rosser NFT Gallery + RT Solutions packaged offers

## Template fields

Use these fields in all drafts:
- `{{contact_name}}`
- `{{company_or_org}}`
- `{{offer_name}}`
- `{{offer_code}}`
- `{{price_or_range}}`
- `{{deposit_terms}}`
- `{{timeline}}`
- `{{booking_link}}`

## Proposal skeleton (all offers)

Subject: `{{offer_name}} proposal for {{company_or_org}}`

Body:
1. Scope summary in 2-3 bullet points.
2. Deliverables + exclusions.
3. Timeline and milestone checkpoints.
4. Pricing and deposit terms.
5. Required intake items before start.
6. CTA: confirm + payment/deposit link.

## Objection response templates

### Budget objection
- "We can start with the packaged scope and phase expansion after the first delivery milestone."

### Timing objection
- "We can hold your slot with deposit and lock the kickoff date while final materials are prepared."

### Authority objection
- "I can send a one-page summary with scope, timeline, and deposit terms for stakeholder review."

## Follow-up cadence (deterministic)

- D1: first follow-up, restate value + CTA.
- D3: include one proof point + deadline reminder.
- D7: offer alternate option (smaller package or discovery call).
- D14: recycle to nurture queue unless explicit "not now" date given.

### Branch handling

- `no_response` branch: default for D14 recycle (`followupSequence=4`), route to nurture with a lighter cadence.
- `not_now` branch: when lead profile includes `followupDisposition=not_now` (or `notNowUntil` / `nextFollowupAt`), schedule follow-up for requested timing.

## Offer-specific CTA lines

### Rosser NFT Gallery
- `RNG-MINI-REPLICA`: "Reserve your selected piece directly from catalog."
- `RNG-COMMISSION-SCULPTURE`: "Reply with size, finish, budget, and deadline to issue deposit invoice."
- `RNG-HISTORICAL-PRESERVATION`: "Book a preservation consult to confirm handling and timeline."
- `RNG-PRIVATE-EVENT-RENTAL`: "Submit date, guest count, and event type for a date-hold invoice."

### RT Solutions
- `RTS-QUICK-WEBSITE-SPRINT`: "Book sprint intake and pay deposit to lock launch window."
- `RTS-AI-LUNCH-LEARN`: "Share audience + outcomes and reserve date with deposit."
- `RTS-AI-TEAM-TRAINING`: "Send team profile and goals to receive a tailored training plan."
- `RTS-CUSTOM-BUILD-DISCOVERY`: "Book paid discovery to produce scoped implementation plan."
