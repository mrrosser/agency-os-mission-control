# Rosser Gallery intake, CRM, and transactional notifications

## Objective

Add one strict, retry-safe service receiver for Rosser Gallery and RT Solutions
website forms/chat intake. Project each accepted submission into the existing
Firestore CRM, preserve transactional and marketing consent as separate scopes,
queue one owner alert and one warm submitter acknowledgment, and deliver those
messages through the owner's connected Gmail account without allowing callers to
choose recipients or templates.

## Scope

- New `POST /api/integrations/rosser-gallery/intake-leads`; the existing collector
  endpoint remains unchanged.
- V1 lanes: `artist_call`, `vendor_interest`, `program_proposal`,
  `gallery_support`, `community_signup`, `contact_message`, and
  `meeting_interest`.
- Public business units `rosser_gallery` and `rt_solutions`, mapped to existing
  server-owned CRM values.
- Allowlisted meeting intents and lane-specific, non-PII metadata enums.
- 32 KiB cap, bearer auth, event-key idempotency, correlation IDs, bounded event
  age, daily transactional quota, and redacted structured logs.
- Transactional lead, timeline, consent, contact-identity, receipt, notification
  outbox, notification receipt, and rate-limit writes.
- Purpose-scoped transactional response and marketing consent; no cross-business
  consent inheritance.
- Two server-rendered multipart notification templates per event: owner alert to
  `mrosser@rossergallery.com` and acknowledgment to the validated CRM contact.
- Protected Gmail worker with claims, leases, deterministic Message-ID recovery,
  bounded retry/dead-letter state, immediate best-effort trigger, and scheduler
  fallback.
- Unit and smoke coverage with Firestore, Gmail, OAuth, and HTTP boundaries mocked.
- Local and Cloud Run configuration/deployment runbook.

Not in scope: website deployment, calendar booking, arbitrary email composition,
marketing campaigns, SMS, changes to the collector receiver, production deploy,
traffic promotion, secret creation, or live test email.

## Design decisions

1. `X-Idempotency-Key` must exactly equal `externalEventId`; receipts bind the
   canonical payload, owner, workspace, business unit, and lane.
2. Sender-provided owner/workspace/CRM tags/recipients/templates are impossible in
   the strict contract. Tags, next actions, recipient routes, and template
   versions are server-derived.
3. The public `rosser_gallery` value maps to the legacy CRM value
   `rosser_nft_gallery`; `rt_solutions` remains unchanged. One HMAC customer key
   deduplicates contacts while business scopes stay distinct.
4. `transactionalContactConsent: true` authorizes only the reply and thank-you
   associated with this submission. Marketing requires a separate boolean plus
   business-appropriate interests and is append-only within that business scope.
5. CRM ingest and two notification channels are committed atomically. Ingest
   succeeds even when the immediate worker trigger is unavailable; queued work is
   retained for scheduler retry.
6. The worker revalidates owner UID, CRM business route, template version, format,
   owner recipient, and submitter recipient against the CRM customer before Gmail.
7. Each channel has a deterministic Message-ID. A reclaimed lease searches Sent
   Mail first, allowing a worker that lost the provider response to record success
   without blindly sending again.
8. Gmail delivery is multipart/alternative. Provider failures receive bounded
   exponential retry and then `dead_letter`; receipts store error codes, never
   provider error bodies or contact content.

## Milestones

- [x] Freeze and publish the exact v1 JSON contract and synthetic fixture.
- [x] Add strict authenticated route and readiness response.
- [x] Add transactional CRM projection, consent scopes, idempotency, quota, and
  two deterministic notification channels.
- [x] Add warm Marcus/Rosser and RT Solutions acknowledgment templates with
  lane-specific calls to action.
- [x] Add protected Gmail worker, multipart delivery, per-channel claim/lease,
  sent-message recovery, retry, and dead-letter behavior.
- [x] Add immediate internal trigger that cannot make ingest fail.
- [x] Add unit and smoke tests with mocked external boundaries.
- [x] Add local/deploy/operations runbook and environment template.
- [x] Run final focused and repository quality gates and record results.
- [x] Commit the scoped implementation. No deploy or push is authorized here.

## Verification gates

```powershell
npx vitest run tests/unit/rosser-gallery-intake-contract.test.ts `
  tests/unit/rosser-gallery-intake-config.test.ts `
  tests/unit/rosser-gallery-intake-notifications.test.ts `
  tests/unit/rosser-gallery-intake-ingest.test.ts `
  tests/unit/rosser-gallery-intake-notification-worker.test.ts `
  tests/unit/rosser-gallery-intake-notification-trigger.test.ts `
  tests/unit/gmail-multipart-delivery.test.ts `
  tests/smoke/rosser-gallery-intake-leads-route.test.ts `
  tests/smoke/rosser-gallery-intake-notification-worker-route.test.ts `
  tests/smoke/rosser-gallery-collector-leads-route.test.ts
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:smoke
npm run build
git diff --cached --check
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
gitleaks git --staged --redact --no-banner --no-color
```

The focused suites must not access Firestore, Gmail, or any live endpoint. Build
and repository-wide tests must pass. Existing dependency advisories are recorded,
not force-fixed in this scoped change.

## Verification results

- Initial focused intake suite: PASS, 32 tests across nine files.
- Initial scoped ESLint: PASS.
- Initial TypeScript `--noEmit`: PASS.
- Final focused intake plus legacy collector suite: PASS, 43 tests across ten
  files.
- Repository unit suite: PASS, 315 tests across 87 files.
- Repository smoke suite: PASS, 169 tests across 73 files.
- Repository ESLint: PASS.
- Final TypeScript `--noEmit`: PASS.
- Production build: PASS, 98 routes/pages. The existing protobuf dynamic-import
  warning remains unchanged.
- Staged diff check: PASS.
- Staged gitleaks scan: PASS, 140.87 KB scanned with no leaks.
- Full dependency audit: FAIL on 25 inherited findings (11 moderate, 13 high,
  one critical). The critical advisory is in dev-only `vitest@3.2.4`; no
  dependency was changed in this scoped feature.
- Production-only dependency audit: FAIL on 22 inherited findings (11 moderate,
  11 high, zero critical). Dependency remediation remains a separate release
  decision because automated fixes would broaden this change.

## Rollback

Stop the website sender and scheduler/immediate-trigger configuration, then revert
this commit. Existing CRM, consent, ingest receipt, notification outbox, and
notification receipt records remain for audit. Rollback never deletes contact or
consent history automatically.
