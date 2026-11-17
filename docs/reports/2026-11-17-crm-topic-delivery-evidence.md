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
