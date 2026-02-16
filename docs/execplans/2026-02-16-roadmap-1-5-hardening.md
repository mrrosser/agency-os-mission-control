# ExecPlan: Roadmap 1-5 Follow-up Hardening (2026-02-16)

## Goal
Implement the next requested five improvements in a single scoped batch:
1) reduce calendar no-slot skips,
2) harden saved-template payload handling,
3) improve lead click-through + phone visibility,
4) normalize enrichment output from Places + Firecrawl,
5) improve OAuth/Drive access-denied UX guidance.

## Scope
- Scheduling: expand slot search windows (including optional weekend search), carry no-slot diagnostics into receipts/logs.
- Templates: make `/api/leads/templates` tolerant to loose payload types and overlong inputs.
- Journey UI: make lead cards easier to open, add call action + contact hints.
- Enrichment: allow Firecrawl to fill missing phone/social/metadata even when email already exists; merge contact fields deterministically.
- Drive UX: classify OAuth/scopes/verification errors and render actionable guidance.

## DoD Gates
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:smoke`
- [x] Targeted behavior checks completed and documented

## Local Run / Verify
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Smoke tests: `npm run test:smoke`

## Deploy
- Existing deploy path in this repo: `npm run deploy:firebase`
- If Cloud Run is used for a service variant, deploy via your standard `gcloud run deploy ...` pipeline with the same build artifact.

## Notes
- No secrets added to code; Secret Manager/env usage remains unchanged.
- Changes are intentionally incremental and reversible.
