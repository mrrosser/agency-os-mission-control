# Warm reconnect campaign review

## Goal

Give Marcus a native Mission Control review surface for one warm, human
reconnect email covering Marcus Rosser, Rosser Gallery, and RT.Solutions. The
release may render and review the campaign, but it must not create provider
drafts, send messages, look up social profiles, call, text, or treat a stored
contact as permission.

## Verified baseline

- The canonical portfolio registry is aggregate-only and deliberately reports
  outreach blocked.
- The recorded baseline is 1,830 people, 403 email contact points, 1,694 phone
  contact points, and 1,709 people with no brand assignment.
- All 2,097 contact points are recorded with unknown permission, all 1,915
  source records have no permission basis, and the canonical registry records
  no permission events or suppressions.
- Rosser Gallery publicly lists `2505 N Tonti St, New Orleans, LA 70117` and a
  monitored gallery mailbox, but this review keeps both sender/legal-entity
  and physical-address gates missing until Marcus confirms the exact sender of
  record for the umbrella campaign.
- `https://rossergallery.com/community#community-signup` captures explicit
  Rosser Gallery email consent and interests. It is an acquisition form, not a
  preference/withdrawal center, and it does not confer RT.Solutions or umbrella
  Marcus-brand consent; the campaign CTA therefore remains disabled.
- Existing Gmail and follow-up routes are not campaign executors: they do not
  bind a canonical recipient set, consent evidence, a working unsubscribe
  path, and an immutable campaign approval into one action.
- A prior address-book, Sheets, or Blinq record is relationship evidence to
  review, not marketing consent.

## Release boundary

- Review-only. No Firestore writes and no external provider calls. The route
  explicitly disables the common server-error telemetry persistence path.
- Use only aggregate CRM counts already returned by
  `/api/crm/registry/summary`; do not add contact names, email addresses, phone
  numbers, or source payloads to the browser response.
- Publish one versioned server-owned draft with a plain-text alternative and a
  visual preview. The preview may use a provenance-checked Marcus Rosser image,
  but readable copy, sender identity, disclosure, address, preference link,
  and unsubscribe text must remain live text.
- The preview fingerprint binds the copy version, subject, preheader, plain
  text, visual asset, CTA placeholder, activation gates, and explicit review
  exclusions. It carries no approval, recipient-selection, or send authority.
- The review artwork is the owned Rosser Gallery `glass-braider-black` asset.
  The served 1280px WebP was independently read back as 66,480 bytes with
  SHA-256 `d53693963446e74b53ee9d2a4eb617ba251bf3cfe73b686922f2a2f10ebf2ed4`;
  it is now vendored under a content-addressed filename, so the review makes no
  third-party image request. Provenance is pinned to `mrrosser/RNGwebsite`:
  derivative asset commit `ba574e78afb280391c93c1ab6d796863c746ec62`
  (`public/art/glass-braider-black-1280.webp`) and rights/manifest evidence
  commit `69f3e2c255ed988754f866bb645bb7ed0a11e656`. The manifest describes the
  source JPG with SHA-256
  `f680db88a56b7b5c80808aaf153577ea431512a5c0e149878054fdbe66a0c243`;
  the delivered WebP has the distinct hash above. Existing campaign provenance
  permits the internal preview, while exact email-channel approval remains an
  activation gate.
- A review fingerprint is integrity evidence only. It does not approve,
  enqueue, draft, claim, or send an email.
- SMS, calls, prerecorded or AI voice, automated social matching, bulk social
  DMs, payments, account creation, and provider/browser actions remain outside
  this release.

## Product decisions

- Campaign: **A note from Marcus — stay connected**.
- Primary CTA: **Choose what you’d like to hear about**.
- Preference topics are Marcus Rosser art, Rosser Gallery, RT.Solutions, and a
  global do-not-contact option. The choices are not activated until a verified
  preference endpoint exists.
- The first future external test is email-only and limited to 5–10 personally
  recognized, provenance-reviewed, unsuppressed recipients. Expansion requires
  separate evidence and approval.
- Unknown phone rows cannot be used for SMS. Social outreach stays manual,
  contextual, and limited to known existing connections.

## Implementation

- [x] Add the versioned campaign review contract, canonical copy, activation
  gates, and deterministic fingerprints.
- [x] Derive held/eligible counts from the existing aggregate registry without
  weakening its blocked state.
- [x] Add a mobile-first campaign review component to the native CRM page.
- [x] Render component-only visual and plain-text previews, exact scope exclusions, pilot
  stop conditions, and the remaining activation checklist.
- [x] Add unit and smoke coverage proving the review cannot authorize or call
  an external provider.
- [x] Run focused tests, TypeScript, scoped ESLint, production build, diff
  checks, dependency audit, and Gitleaks.
- [x] Obtain independent review before merge or deployment.

Independent review verdict: PASS. Final evidence was 24 focused CRM/warm
tests, 2 desktop/mobile Playwright cases, TypeScript, scoped ESLint, a complete
98-page production build, production-start route/asset smoke, staged Gitleaks,
diff checks, and the high-severity dependency audit.

## Activation gates for a later release

1. Confirm the sender of record, monitored reply-to, legal entity, and valid
   physical postal address.
2. Publish and test a preferences/unsubscribe endpoint; process requests into
   a canonical suppression service immediately.
3. Reconcile historic unsubscribes, complaints, hard bounces, SMS STOPs, and
   entity-specific do-not-contact requests.
4. Create a channel-specific consent ledger with provenance, disclosure text,
   sender, topic, collection method, and timestamp.
5. Verify SPF, DKIM, DMARC, TLS, bounce handling, complaint monitoring, and the
   chosen provider's permission for the pilot.
6. Build a bounded recipient-review queue with one record per person/address,
   immutable audience and artifact fingerprints, approval expiry, and material
   drift checks.
7. Add a durable, one-time claim/receipt executor with a kill switch, low rate,
   and stop-on-complaint, unsubscribe, auth, or receipt failure.

## Local verification

```powershell
npx vitest run tests/unit/warm-reconnect.test.ts `
  tests/unit/warm-reconnect-ui.test.ts `
  tests/smoke/warm-reconnect-review-route.test.ts
npx tsc --noEmit --incremental false
npx eslint lib/crm/warm-reconnect.ts `
  lib/crm/warm-reconnect-types.ts `
  components/crm/warm-reconnect-campaign.tsx `
  app/dashboard/crm/page.tsx
npm run build
npx playwright test tests/playwright/warm-reconnect-review.spec.ts `
  --project=chromium --workers=1
npm audit --audit-level=high
git diff --check
```

No local test may access recipient values, create a Gmail draft, send a
message, or mutate a CRM permission/suppression record.

## Deployment and rollback

Deploy only through the repository's existing protected Firebase Hosting and
SSR workflow after exact-head CI and independent review. Post-deploy, verify
the CRM route on mobile and desktop, the aggregate-only API cache/auth
contract, and the absence of new provider calls or `crm_*` writes.

Rollback by reverting this review-only commit and redeploying the prior exact
revision. No data migration or cleanup is required because this release adds
no campaign records or contact mutations.
