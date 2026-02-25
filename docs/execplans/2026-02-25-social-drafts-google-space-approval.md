# ExecPlan: Social Draft Approvals in Google Space + Variant Reliability Follow-through

Date: 2026-02-25  
Owner: Codex / Marcus  
Status: Completed

## Goals

1. Complete requested follow-through items 1-3 from the revenue loop:
   - Firecrawl capacity fallback behavior
   - 7-day control vs variant split reporting
   - commit-ready implementation updates
2. Add a social media draft approval workflow that lets operators review and approve drafts from Google Space, including image/video context links for IG Stories and Facebook.

## Constraints

- No secrets in repo; webhook URLs/tokens via env/Secret Manager.
- Draft-first approval flow only (no auto-post side effects in this slice).
- Structured logs + correlation IDs across new routes/tool calls.
- Input validation + idempotency for external create actions (Google Chat webhook posts).
- Add tests (unit + smoke) with mocked external calls.

## Deliverables

### D1. Firecrawl fallback hardening
- Detect quota/credit exhaustion (HTTP 402 / insufficient-credits messages).
- Stop additional Firecrawl enrichment calls for the current batch once quota exhaustion is detected.
- Keep pipeline runs alive in degraded mode without noisy repeated failures.

### D2. 7-day variant split automation
- Add script to aggregate last-7-day run performance by template variant (A/B).
- Output a deterministic markdown report under `docs/reports/`.
- Make script callable via npm script for daily/weekly operations.

### D3. Social drafts + Google Space approvals
- Add social draft API routes (create/list + worker-task).
- Add Google Space approval post with card payload showing draft copy + media links.
- Add approval decision endpoint with secure tokenized links (`approve` / `reject`).
- Persist social draft records and decision audit state in Firestore.

### D4. Docs + verification
- Add operator runbook for social draft approvals (env vars + usage).
- Run targeted unit/smoke tests for new behaviors.
- Produce final implementation summary + next steps.

## Progress

- [x] D1: Firecrawl fallback guard implemented.
- [x] D2: variant split report script implemented and baseline report generated.
- [x] D3: social draft approval workflow implementation.
- [x] D4: docs + test verification + handoff.

## Verification

- `npx vitest run tests/unit/firecrawl-enrichment.test.ts tests/unit/social-drafts.test.ts tests/smoke/social-drafts-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/social-draft-decision-route.test.ts`
