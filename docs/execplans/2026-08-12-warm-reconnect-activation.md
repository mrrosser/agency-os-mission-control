# Warm reconnect activation control plane

## Goal

Turn the deployed warm reconnect concept into a consent-aware operator flow:
reconcile and deduplicate a deliberately tiny audience, publish a safe
preferences/unsubscribe surface, bind an exact 5-person pilot to an expiring
approval, and keep Gmail execution disabled until every delivery gate is
verified. Expansion from five to 6–10 recipients requires a second approval.

## Confirmed baseline

- The canonical registry currently contains 1,830 people and 403 email contact
  points, but every contact point has unknown permission and every source
  record has permission basis `none`.
- A stored address-book, Sheets, or Blinq record is relationship evidence to
  review. It is not opt-in and is never upgraded automatically.
- Canonical permission events and suppressions are empty. The older
  `lead_run_org_dnc` ledger is separate and cannot independently govern this
  campaign.
- The existing `/api/gmail/send` route accepts caller-owned recipients/copy and
  uses a non-atomic check/send/write idempotency helper. It is explicitly
  excluded from this campaign.
- Google connections are organization-specific: `rt_solutions_work` and
  `rosser_gallery_work`. Marcus must personally choose the intended Google
  account and approve Google's consent screen.
- The scheduled `aicf-south-day1` failure is a separate legacy/no-context
  Google mapping. Connecting RT.Solutions or Rosser Gallery does not repair
  that AICF worker.

## Authority boundary

- This release may create internal pilot, recipient-review, approval, token,
  permission-event, suppression, and receipt records only through authenticated
  or capability-token routes with exact workspace binding.
- It may not infer consent, select a recipient automatically, send to more than
  the approved set, substitute a destination, create Gmail drafts, send SMS,
  call, find social profiles, or send direct messages.
- Approval and launch are separate. Approval persists exact action, artifact,
  audience, recipient, sender-profile, rate, stop-policy, scope, and exclusion
  fingerprints for 24 hours. Launch authorizes only those exact five Gmail
  sends; it cannot broaden them. Provider execution remains independently
  dormant because the kill switch defaults off and this release installs no
  scheduler.
- Initial launch remains provider-disabled until sender identity, postal
  address, reply-to, Gmail account binding, authentication, preference center,
  suppression reconciliation, artwork channel approval, and exact recipient
  evidence all pass.
- Any drift, unsubscribe, complaint, bounce, DNC match, OAuth error, provider
  ambiguity, or receipt failure stops the whole pilot. Ambiguous delivery is
  never retried automatically.

## Data and privacy rules

- Normalize email conservatively (NFKC, trim, lowercase, IDNA domain). Do not
  strip Gmail dots or plus tags.
- Deduplicate by both canonical person and workspace-scoped destination hash.
  Shared or conflicting destinations require review and are never auto-merged.
- Store only opaque preference-token digests. The preference capability appears
  only in the URL fragment and browser POST body, never Firestore or platform
  request logs. The down-scoped RFC 8058 unsubscribe-only capability must be in
  an HTTPS path and may therefore appear in managed Hosting or request access
  logs; it can only reduce communication scope and application logs omit it.
- Preference and one-click-unsubscribe capabilities are distinct. A leaked
  unsubscribe token can only reduce communication scope.
- GET never mutates. Global unsubscribe is sticky and atomically appends a
  permission event, activates a canonical suppression, and mirrors the legacy
  DNC entry. Re-subscription requires new explicit evidence.
- Public preference responses are non-enumerating, `no-store`, `no-referrer`,
  CSP-restricted, and free of analytics or remote assets.

## Implementation checklist

- [x] Add conservative candidate normalization/deduplication and exact
  relationship-evidence review.
- [x] Add durable pilot, recipient, decision, event, and launch state with
  server-derived workspace authority.
- [x] Add a public preference page and separate one-click unsubscribe endpoint.
- [x] Add exact action/artifact/audience fingerprints, 24-hour approval, and
  explicit 5-recipient initial cap.
- [x] Add a send-only Gmail OAuth preset and expire OAuth state promptly.
- [x] Add native CRM controls for profile connection, reconciliation, approval,
  launch readiness, and stop.
- [x] Add a campaign-only multipart MIME/execution boundary with transactional
  claims and deterministic receipts; keep provider calls disabled until all
  gates are live-verified.
- [x] Add an active-pilot lock and a cross-pilot, per-person/destination
  invitation ledger. A pre-provider stop may release reservations; a provider
  attempt, sent receipt, or ambiguous outcome can never release them.
- [x] Fail closed before selection when the canonical email registry exceeds
  the bounded 500-contact reconciliation window; no partial audience can be
  approved. A later indexed migration may lift this hold separately.
- [x] Add unit, smoke, route, and mobile/desktop browser coverage with every
  external provider mocked.
- [x] Run TypeScript, scoped ESLint, production build, dependency audit,
  Gitleaks, diff checks, and independent security review.
- [ ] Merge through protected exact-head CI and deploy using the existing
  Firebase Hosting/SSR workflow.

## Local verification

```powershell
npx vitest run tests/unit/warm-reconnect*.test.ts `
  tests/smoke/warm-reconnect*.test.ts
npx tsc --noEmit --incremental false
npx eslint lib/crm/warm-reconnect-*.ts components/crm/warm-reconnect-*.tsx `
  app/api/crm/warm-reconnect/**/*.ts app/preferences/page.tsx
npm run build
npx playwright test tests/playwright/warm-reconnect-review.spec.ts `
  --project=chromium --workers=1
npm audit --audit-level=high
git diff --check
```

Tests must not read live contact values, initiate OAuth, create provider drafts,
send messages, or mutate production CRM data.

## Deployment and rollback

Deploy only after exact-head tests/build/preview and independent security
review. Post-deploy, verify authenticated CRM readiness without selecting or
approving recipients, public preference routes without a live token, exact
cache/security headers, organization Google status, zero provider calls, and
zero new sends.

Rollback code by reverting the exact release and restoring the prior Hosting
rewrite/SSR revision. Keep append-only permission and suppression history; do
not delete valid opt-outs during code rollback. Stop any nonterminal pilot and
retain its decisions/receipts for audit.
