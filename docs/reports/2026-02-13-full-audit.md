# Full Audit Report (2026-02-13)

## Baseline Evidence
- RT loop: see `docs/reports/latest-run.md`
- Security scan: see `.security/reports/npm-audit.txt`
- Playwright: `npm run test:pw` passes (local dev server)

## Current Product Surface (High Level)
- Auth: Google + Apple sign-in
- Lead Engine: source (Places/Firestore) -> score -> enrich (Firecrawl) -> outreach (Gmail/SMS/Call/Avatar) -> booking (Calendar)
- Knowledge Base: Google Drive picker + delta scan
- Ops: telemetry groups + lead run receipts/audit drawers + quota alerts

## Changes Shipped In This Audit Sprint
- Removed all current eslint warnings (hooks deps, unused vars, `any` types) and documented blob-image exceptions.
- Optimized onboarding tour mounting to avoid secrets-status auto-fetch unless the tour is eligible to show.
- Normalized Playwright local base URL to `http://localhost:3000` to avoid Next.js dev cross-origin warnings.

## Findings (Prioritized)

### P0 (Breaks users / production risk)
- Google Drive / sensitive Google scopes are blocked for external users until OAuth verification is complete.
  - Impact: users can sign in, but Drive-based Knowledge Base connection may fail with "access denied / app not verified".
  - Mitigation (in product): keep Places-only lead scans functional; make Drive optional; guide users through the limitation.

### P1 (High leverage quality + reliability)
- Fixed eslint warnings + hook deps across Operations UI and calendar scheduling route (reduces regressions + improves maintainability).
- Reduced wasted `/api/secrets` calls:
  - `FirstScanTour` is mounted globally; it no longer auto-fetches secrets status on every dashboard page load.

### P2 (Performance / UX polish)
- Places photo thumbnails can increase request volume for larger lead limits; consider lazy-loading (IntersectionObserver) and/or only showing thumbnails for top N leads.
- `app/dashboard/operations/page.tsx` (~2.6k LOC) and `app/api/lead-runs/[runId]/jobs/worker/route.ts` (~1.3k LOC) are maintainability risks; prioritize refactors once behavior stabilizes.

## Competitor Gap Scan (Initial)
- Apollo / ZoomInfo (data + enrichment)
  - Gap: large contact database (people + verified emails/phones), advanced filters (title/seniority/tech stack/intent).
  - Practical response: keep Places for business discovery but add stronger on-page enrichment + contact extraction + verification.
- Clay (workflow enrichment)
  - Gap: flexible multi-provider enrichment pipelines + table-first UX for bulk ops.
  - Practical response: keep current “run” model but add enrichment stages (Places details -> Firecrawl -> optional verifier) with receipts + replay.
- Instantly / Smartlead / Lemlist (cold outreach)
  - Gap: sequencing, deliverability tooling, unsubscribe handling, inbox rotation.
  - Practical response: start with follow-up scheduling + queued drafts (Gmail) before building a full sequencer.
- Outreach / Salesloft (engagement + team workflow)
  - Gap: team assignment, tasks, SLAs, call logging, analytics dashboards.
  - Practical response: focus on org-level templates, quotas, and auditability first; add “handoff to human” steps.
- HubSpot / Pipedrive (CRM)
  - Gap: canonical pipeline + dedupe + lifecycle + reporting.
  - Practical response: implement stable lead IDs, domain-based dedupe, and one-click export (CSV + webhook) before deep CRM integrations.

## Recommended Next Improvements (Top 10)
1) Google OAuth verification path (blocking Drive):
   - Own/verify a domain, ensure consent screen home page includes Privacy + ToS links, submit for verification for requested scopes.
   - Keep requesting Drive/Gmail/Calendar scopes incrementally (already implemented) so core lead scans keep working during verification.
2) Add a "Replay First Scan Tour" entry point in Settings (and/or a "Help" menu).
3) Places photo thumbs: lazy-load and cap concurrency to avoid 10-25 parallel image fetches.
4) Lead detail UX: make LeadReceiptDrawer openable directly from the tile (click or "Details" action) and show one-click Website/Maps/Call/Email when available.
5) Lead enrichment expansion (low-risk, high value):
   - Prefer Places: phone, website, hours, rating, status, lat/lng, and social links when present.
   - Prefer Firecrawl: extract emails and contact page links; store as `emails[]` + `phones[]` with confidence tags.
6) Lead run scheduling UX: when no slot exists, show explicit "No slot found" (not "skipped"), and keep outreach moving via a drafted scheduling email.
7) Reduce file size risk:
   - Break `app/dashboard/operations/page.tsx` into smaller components (query panel, templates, journey list, receipts/audit drawers).
8) Add rate limiting for high-cost endpoints (Places + Firecrawl) keyed by uid/org + correlationId for tracing.
9) Expand smoke tests for the top user flows (login -> first scan -> template save -> run receipts -> drawer opens).
10) Add a lightweight in-app changelog banner after deploys to reduce "I don’t see the change" reports (ties to runId/buildId).

## Notes / Assumptions
- OAuth verification blocks Drive scopes for external users until verified; app should degrade gracefully with Places-only sourcing and local uploads.
