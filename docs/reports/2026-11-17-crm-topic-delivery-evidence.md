# CRM topic and delivery evidence repair, 2026-11-17

## Scope and safety
- Topic counters read current preference records separately from global default permission, events and selected-batch history. Both topics count once in the union.
- Contact ownership conflicts, duplicate email identities, duplicate preference records, canonical opt-outs and suppressions are held. Failed/over-bound reads return unknown, never zero.
- Diagnostic counts are not send authority. Legacy DNC, delivery state, campaign eligibility and consent/address changes still require their existing checks. No contacts, consent or suppressions are mutated.
- Three workspace-scoped projected queries, maximum 5,001 documents per collection. This is bounded but not cached; evaluate aggregation if registry growth makes those reads costly.
- Separately threaded Gmail DSNs use a separate authenticated endpoint, receipt-bound original identities and an immutable observation collection. Existing exact-thread schema remains untouched.
- DSN scope is Google reports within 30 days after sending, at most 400 originals, 50 candidates, 256 KiB per response and 60 seconds. Partial and unattributed observations remain explicit. No sends or automatic suppression changes.

## Evidence and validation
- Previous dashboard global opt-in zero was not proof of no topic preferences. Five historical batch selections were observed (Gallery 3, RT 4, both 2). Do not treat that as a reconciled current sendable audience or confirmation of the owner's approximate 36 count.
- Exact lockfile dependencies restored. follow-redirects patched from 1.16.1 to compatible 1.16.3 for GHSA-mrwp-f3q8-3g9p. npm audit: 0 high/critical, 21 moderate and 1 low remain.
- Topic/registry 17 tests pass; preference and ESLint-boundary regression 38 tests pass; DSN and existing reader/UI 84 tests pass. TypeScript passes. Full lint has zero errors and two existing unused-variable warnings. Staged gitleaks finds no leaks.
- Two preference tests now pass an explicit pre-expiry fixture timestamp; production expiry behavior is unchanged.
- Production build passed. Full unit and smoke suites passed: 2,539 tests across 275 files. GitHub CI tests, promptfoo and Firebase build validation passed for the initial patch; the folded-header follow-up requires fresh checks. No live mailbox refresh or live aggregate reconciliation has yet been executed.

## Authenticated production verification and follow-up
- PR #68 production promotion completed successfully at commit 629302f. Authenticated live topic diagnostics: 5 current contact-point selections, Gallery 3, RT 4, both 2, held 11; global default opt-ins remain distinct at 0. The approximate 36 confirmations are not yet reconciled.
- Live Batch 5 separate-notice scan verified 28/28 original sent messages and inspected 15/15 Google reports. Initial result: 0 matched, 15 unattributed. This was not proof of successful delivery.
- A real separately threaded DSN revealed Gmail's empty message/delivery-status parent with one text/plain leaf holding recipient fields. The follow-up parser accepts only that bounded shape, preserves original-ID/sender/recipient bindings and rejects competing bodies, duplicate IDs and metadata/recipient ambiguity. Five sanitized regression cases added; classifier/discovery suite 33 passed.
- The UI connection message was incorrectly tied to the full campaign activation request's deadline, not an independent sender-profile check. A timeout therefore did not establish a lost Google connection. The next patch separates owner-gated read-only sender-status retrieval from campaign scans while retaining full activation freshness and launch gates.
- Follow-up changes require fresh CI and production verification before claiming the live DSN attribution and sender-status fixes are complete. No sends, consent writes or suppression writes were performed.
