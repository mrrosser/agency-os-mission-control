# ExecPlan: Lead Enrichment + UX (Phase 5)

Date: 2026-02-13

## Goals

- Improve lead enrichment quality using:
  - Google Places Details (more fields).
  - Firecrawl (emails + phones + socials + "contact" page fallback).
- Improve lead UX:
  - Make it obvious how to open the lead website / Maps listing.
  - Surface enrichment fields in the receipt drawer.
  - Add CSV export for lead runs.
- Add dedupe + domain clustering signals to reduce repeated leads and explain why fewer than `limit` may be returned.

## Non-Goals (for this phase)

- Full “new Places API” migration to `places.googleapis.com` v1 (field masks, sessions).
- Third-party enrichment vendors (Apollo/Clearbit/etc.).
- HubSpot/Pipedrive OAuth sync (CSV export is the first step).

## Plan

1) Data model
- Extend `LeadCandidate` with:
  - Places: `businessStatus`, `openNow`, `openingHours`, `priceLevel`, `lat`, `lng`.
  - Web: `websiteDomain`, `socialLinks`, `phones`.
  - Clustering: `domainClusterSize`.

2) Google Places enrichment
- Expand Details `fields` and map them into the lead model.
- Add/adjust unit tests.

3) Firecrawl enrichment
- Extend Firecrawl client to optionally return `links`.
- Update lead enrichment to:
  - Extract emails (existing).
  - Extract phone numbers.
  - Extract social links (LinkedIn/IG/FB/X/YT/TikTok).
  - Scrape a bounded "contact" page when needed.
- Add/adjust unit tests.

4) Dedupe + domain clustering
- Compute `websiteDomain` and `domainClusterSize` in sourcing.
- Add a conservative dedupe pass for exact-ish duplicates (name+location, name+domain).
- Return diagnostics to explain removals.

5) UI improvements
- Lead tiles: visible buttons for "Website" and "Maps".
- Receipt drawer: quick links + enriched fields.
- Add CSV export for loaded receipts.

6) Verification
- `npm test`
- `npm run build`
- Deploy (`firebase deploy --only hosting`)

## Rollback

- Revert commits touching lead enrichment and operations UI, redeploy.

