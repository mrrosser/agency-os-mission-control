# Rosser Gallery generic intake and notification runbook

## Outcome

`POST /api/integrations/rosser-gallery/intake-leads` accepts one strict v1 form or
chat submission, writes it to the existing CRM, and atomically queues:

1. an owner alert to the server-pinned `mrosser@rossergallery.com`; and
2. a warm acknowledgment to the validated submitter email.

When the internal worker URL and token are configured, the intake route triggers a
bounded Gmail worker cycle immediately. A trigger timeout or failure never rolls
back the accepted submission; the durable outbox remains queued for the next
worker or scheduler cycle.

The existing collector endpoint at
`/api/integrations/rosser-gallery/collector-leads` is unchanged.

## Exact v1 request

Headers:

```text
Authorization: Bearer <CRM_INGEST_TOKEN>
Content-Type: application/json
X-Idempotency-Key: <must exactly equal externalEventId>
X-Correlation-Id: <optional safe 8..128 character identifier>
```

Body:

```json
{
  "schemaVersion": 1,
  "externalEventId": "intake_d5d5cbb7-6fd5-4e71-a537-f3975646630f",
  "lane": "meeting_interest",
  "businessUnit": "rosser_gallery",
  "occurredAt": "2026-07-28T20:30:00.000Z",
  "source": "website_chat",
  "contact": {
    "name": "Example Community Member",
    "email": "community.member@example.com"
  },
  "summary": "I would love to arrange a private walkthrough and learn more about The Nurturer.",
  "transactionalContactConsent": true,
  "marketingConsent": false,
  "marketingInterests": [],
  "intent": "private_gallery_walkthrough",
  "pagePath": "/visit"
}
```

The checked-in fixture is
`contracts/rosser-gallery/intake-lead.v1.json`.

### Allowlists

- `lane`: `artist_call`, `vendor_interest`, `program_proposal`,
  `gallery_support`, `community_signup`, `contact_message`, `meeting_interest`.
- `businessUnit`: `rosser_gallery`, `rt_solutions`.
- `source`: `website_form`, `website_chat`, `gallery_staff`.
- meeting `intent`: `public_gallery_visit`, `private_gallery_walkthrough`,
  `consulting_consultation`, `artwork_conversation`, `purchase_guidance`,
  `community_collaboration`.
- Rosser marketing interests: `gallery_news`, `artist_opportunities`,
  `events_programs`, `shop_releases`, `community_updates`.
- RT Solutions marketing interests: `rt_solutions_insights`,
  `community_updates`.

`intent` is required only for `meeting_interest`. Optional `metadata` is strict and
lane-specific: `offeringCategory` for vendor interest, `programType` for program
proposal, `supportType` for gallery support, or `contactTopic` for a contact
message. Artist-call, community-signup, and meeting payloads omit `metadata`.
Unknown fields are rejected.

`marketingInterests` must be empty when marketing consent is false and nonempty,
unique, and business-appropriate when it is true. Optional phones must be E.164.
Optional `pagePath` is relative and cannot include query/hash content.

### Success response

First create returns `201`; exact replay returns `200` and `replayed: true`:

```json
{
  "ok": true,
  "replayed": false,
  "receiptId": "intake_receipt_...",
  "customerId": "rng_customer_...",
  "timelineEventId": "intake_activity_...",
  "notificationChannels": [
    {
      "channel": "owner_alert",
      "outboxId": "intake_email_...",
      "receiptId": "intake_email_receipt_...",
      "status": "queued"
    },
    {
      "channel": "submitter_acknowledgment",
      "outboxId": "intake_email_...",
      "receiptId": "intake_email_receipt_...",
      "status": "queued"
    }
  ],
  "correlationId": "intake-example-0001",
  "receivedAt": "2026-07-28T20:31:00.000Z"
}
```

Retry network failures, `429`, and `5xx` with the exact same payload/event key.
Treat `400`, `403`, `409`, and `413` as terminal and retain them for review.

## Storage and consent

The receiver transaction writes `leads`, `activities`,
`crm_consent_events`, `crm_intake_contact_identities`,
`crm_ingest_receipts`, `crm_ingest_rate_limits`,
`crm_notification_outbox`, and `crm_notification_receipts`.

Transactional contact evidence uses `intake-response-v1`. Marketing evidence uses
`intake-marketing-v1` only when checked. Gallery and RT Solutions have separate
`consentScopes`; an unchecked later form does not revoke an earlier opt-in, and an
opt-in for one business is never copied to the other.

## Gmail delivery safety

The worker endpoint is:

```text
POST /api/integrations/rosser-gallery/intake-notifications/worker
Authorization: Bearer <GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN>
Content-Type: application/json

{"limit":10,"leaseSeconds":90}
```

It accepts only `limit` and `leaseSeconds`; no recipient, subject, body, or template
can be supplied. Before Gmail, it checks the owner UID, CRM route, channel,
template version, multipart format, fixed owner address, and submitter email
against the CRM contact.

Each email receives a deterministic RFC Message-ID. Claims and receipts block
concurrent sends. If a worker lease expires after an ambiguous provider response,
the next worker searches Sent Mail for that Message-ID before sending again.
Failures retry after 30 seconds with bounded exponential backoff, then move both
the channel and its receipt to `dead_letter`.

The connected account needs both Gmail send and readonly scopes: readonly is used
only to search Sent Mail by deterministic Message-ID for retry recovery.

## Required server configuration

Keep all secrets in Secret Manager or the deployment platform's secret store:

```text
CRM_INGEST_TOKEN=<independent 32+ character secret>
ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET=<independent stable 32+ character secret>
ROSSER_GALLERY_CRM_OWNER_UID=<existing owner UID>
ROSSER_GALLERY_CRM_WORKSPACE_ID=<existing workspace ID>
ROSSER_GALLERY_CRM_BUSINESS_UNIT=rosser_nft_gallery
CRM_INTAKE_NOTIFICATION_MAX_ATTEMPTS=5
GALLERY_INTAKE_GMAIL_USER_ID=<Firebase UID whose connected Google account sends mail>
GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN=<independent 32+ character secret>
GALLERY_INTAKE_NOTIFICATION_WORKER_URL=https://<service-host>/api/integrations/rosser-gallery/intake-notifications/worker
```

The owner recipient is compiled server-side as `mrosser@rossergallery.com`; it is
not an environment value or request field. `GALLERY_INTAKE_GMAIL_USER_ID` must own
the CRM outbox records and have a stored Google refresh token with Gmail scopes.

## Local verification

Use only synthetic data and the Firestore emulator. Tests already mock Firestore,
OAuth, Gmail, and worker HTTP:

```powershell
npm ci
npx vitest run tests/unit/rosser-gallery-intake-contract.test.ts `
  tests/unit/rosser-gallery-intake-config.test.ts `
  tests/unit/rosser-gallery-intake-notifications.test.ts `
  tests/unit/rosser-gallery-intake-ingest.test.ts `
  tests/unit/rosser-gallery-intake-notification-worker.test.ts `
  tests/unit/rosser-gallery-intake-notification-trigger.test.ts `
  tests/unit/gmail-multipart-delivery.test.ts `
  tests/smoke/rosser-gallery-intake-leads-route.test.ts `
  tests/smoke/rosser-gallery-intake-notification-worker-route.test.ts
npx tsc --noEmit
npm run build
```

For manual receiver verification, start Firestore with a `demo-*` project, point
the Admin SDK at `FIRESTORE_EMULATOR_HOST`, use synthetic secrets/contacts, and POST
the checked-in fixture. Do not run a write-bearing test against production. Keep
the worker URL unset locally unless a test account is intentionally connected;
there is no live Gmail smoke in this change.

## Cloud Run deployment checklist

1. Build and test the exact reviewed commit; verify a clean worktree and dependency
   audit decision.
2. Bind the two independent tokens and HMAC key from Secret Manager. Set only the
   non-secret owner/workspace/business/Gmail UID values as environment variables.
3. Confirm the configured Google OAuth client and stored token for
   `GALLERY_INTAKE_GMAIL_USER_ID` include Gmail send and readonly scopes.
4. Deploy a zero-traffic/tagged candidate first. Run only authenticated GET
   readiness on the intake receiver; do not POST a real contact or send a live
   email without explicit release approval.
5. After promotion approval, point
   `GALLERY_INTAKE_NOTIFICATION_WORKER_URL` at the promoted service's exact worker
   path and enable the website sender.
6. Configure a one-minute fallback scheduler POST to the same worker route. Supply
   the worker bearer token from approved secret-aware deployment automation; never
   paste it into source, logs, shell history, or the scheduler job description.
7. Read back traffic, environment variable names (not values), Gmail connection
   status, readiness, and queue health before declaring delivery active.

The immediate trigger is the low-latency path; the one-minute scheduler is the
recovery path for trigger timeouts and provider retries.

## Operations

Structured events to monitor:

- `crm.rosser_gallery_intake_ingested`
- `crm.intake_notification.triggered`
- `crm.intake_notification.trigger_failed`
- `crm.intake_notification.delivery_failed`
- `crm.intake_notification.worker_completed`

Investigate `dead_letter` rows by channel receipt ID and correlation ID. Logs do
not contain contact names, email addresses, message bodies, OAuth tokens, or bearer
tokens. Requeue only after correcting the provider/configuration issue; preserve
the deterministic Message-ID and existing receipt.

## Rollback

Disable the website sender and scheduler/immediate-trigger URL, then roll traffic
back to the prior revision. Do not delete CRM, consent, outbox, or receipt records.
Rotate both bearer tokens if either is suspected compromised.
