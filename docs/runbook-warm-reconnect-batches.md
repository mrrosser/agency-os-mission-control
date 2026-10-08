# Reviewed outreach batches and results

## Operator workflow

The CRM Outreach panel reports each batch's durable send receipts and confirmed
preference choices. A completed first pilot unlocks a next recipient list of
1–10 people. Subsequent batches inherit the completed predecessor's approved
email, sender, artwork approval and preference contract. Each new list still
requires its individual relationship review, current gates, exact-list approval
and an explicit **Start approved N-email batch** action. Creating a list or
approving its content alone does not start sending.

The approval lasts 24 hours. This is an expiry, not a waiting period. A launched
batch sends at most one invitation per dispatcher invocation, at least 60 seconds
after the previous provider attempt. A scheduler tick every two minutes is a
suitable cadence. Drift, suppression or uncertain delivery stops execution.
An uncertain provider outcome is never retried automatically.

Completed predecessors and the original campaign lock are immutable. An atomic
follow-on lock prevents parallel successor batches and stale workers. Durable
campaign invitation records exclude previously invited people and addresses,
including changed addresses or merged CRM identities. Never clear a lock or
delete a receipt to make a batch available.

## Results and measurement limits

`GET /api/crm/warm-reconnect/results` returns owner-only batch summaries and
recipient delivery status. Reads are bounded; missing, malformed or capped
evidence is shown as unknown. A completed status requires matching unique send
receipts and executor counts, not the launch status alone.

**Check replies in sent threads** invokes the owner-only
`POST /api/crm/warm-reconnect/results/refresh` with `{ "pilotId": "..." }`.
It uses the existing `rosser_gallery_work` read connection, verifies the actual
Gallery mailbox with Gmail, and reads metadata from only the exact sent threads.
Stored observations contain identifiers, classifications and timestamps; no
message bodies, raw headers, OAuth tokens or preference capability URLs.

Replies must reference the original sent message and match its recipient.
Automatic responses and delivery notices are separate. Counts reflect the last
successful observation. Preference counts reflect choices confirmed through
that batch's links. Total bounces, opens, ordinary clicks and sales conversions
are not collected. A missing metric is not zero.

## Local execution and checks

Use Node 22, install with `npm ci`, configure the existing documented local
environment, and run `npm run dev`. Leave
`WARM_RECONNECT_PROVIDER_SEND_ENABLED` unset or false locally. Provider tests
mock all external APIs:

```powershell
npx vitest run tests/unit --maxWorkers=2
npx vitest run tests/smoke --maxWorkers=2
npm run lint
npm run build
npm audit --audit-level=high --registry=https://registry.npmjs.org/
```

## Deployment and scheduler

Use the protected PR checks and the normal main-branch Firebase merge workflow.
The workflow preserves the existing production send flag and uses its normal
Cloud Run / Hosting revision binding. Do not deploy an unreviewed local build.
Verify the deployed revision before enabling a new scheduler endpoint.

`POST /api/jobs/warm-reconnect-dispatch` requires the existing revenue scheduler
OIDC identity and configured worker UID. It accepts only `{}` and no query
parameters. It selects the server-owned follow-on lock; the caller cannot supply
recipients, a pilot ID, content or approval. No active lock returns `idle`; a
reviewed but unlaunched list returns `awaiting_launch`; neither calls Gmail.

Configure one dedicated job, preserving unrelated jobs:

```powershell
gcloud scheduler jobs create http warm-reconnect-approved-batches --project=leadflow-review --location=us-central1 --schedule='*/2 * * * *' --time-zone=Etc/UTC --uri=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app/api/jobs/warm-reconnect-dispatch --http-method=POST --headers=Content-Type=application/json --message-body='{}' --oidc-service-account-email=revenue-automation-scheduler@leadflow-review.iam.gserviceaccount.com --oidc-token-audience=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app --max-retry-attempts=0 --attempt-deadline=60s
```

Inspect that exact job before creation. If it already exists, compare its target,
identity, audience, body and retry policy; do not create a duplicate. Probe the
deployed route through the existing OIDC path and verify the no-op receipt before
any newly reviewed batch is launched. Scheduler creation does not grant campaign
approval or enroll anyone in ongoing updates.

## Pause and rollback

Pause only this cadence with:

```powershell
gcloud scheduler jobs pause warm-reconnect-approved-batches --project=leadflow-review --location=us-central1
```

The existing provider send flag remains the wider kill switch. Source rollback
uses the protected main release path. Preserve all pilots, locks, invitation
ledgers, receipts, preferences, suppressions and observations. Reconcile stopped
or uncertain deliveries before any operator-approved recovery.
