# Reviewed outreach batches and results

## Operator workflow

The CRM Outreach panel reports each batch's durable send receipts and confirmed
preference choices. A completed first pilot unlocks review of an exact, finite
list of available people. Subsequent batches inherit the completed predecessor's approved
email, sender, artwork approval and preference contract. Each new list still
requires its individual relationship review, current gates, exact-list approval
and an explicit **Start approved N-email batch** action. Creating a list or
approving its content alone does not start sending.

The approval lasts 24 hours. This is an expiry, not a waiting period. A launched
batch sends at most one invitation per dispatcher invocation, at least 60 seconds
after the previous provider attempt. A scheduler tick every two minutes is a
suitable cadence. Drift, suppression or uncertain delivery stops execution.
At that cadence, 100 invitations take roughly 200 minutes. A larger reviewed list
does not increase provider calls per invocation or expand its approved audience.
An uncertain provider outcome is never retried automatically.

There is no marketing recipient-count ceiling or lifetime invitation allowance.
Use the owner's exact approved finite audience, subject to the account-capacity
assessment below and all recipient exclusions. Reconcile the
completed window before preparing its successor; stop after the existing audience
is exhausted. Do not create recurring outreach to newly acquired contacts from
this approval. Unknown newsletter permission remains unknown until the person opts in.

### Provider capacity evidence

The [documented Gmail REST methods](https://developers.google.com/workspace/gmail/api/reference/rest)
do not expose a remaining daily mail-send allowance or reservation endpoint.
The [profile response](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile)
contains mailbox totals and a history ID, not remaining capacity. Do not require
an unavailable numeric counter, or interpret connected status, successful reads,
the provider execution switch or the application cap as quota evidence.

Assess the applicable account edition/trial limits, recent rolling-24-hour sent
messages and recipients across available clients, other planned traffic, and any
current suspension or rate-limit notices. Record the evidence time, coverage and
uncertainty; a partial Sent count is not an exact quota balance. If an existing
provider block has not been resolved, hold the launch. Gmail's
[sending limits](https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace)
use a rolling window and include aliases, delegated sends and vacation responses.
Do not infer paid-account limits from the sender's domain alone.

[API request quotas](https://developers.google.com/workspace/gmail/api/reference/quota)
are separate from daily email limits and may depend on the project's quota cohort.
The Apps Script MailApp counter applies to that service; it is not a Gmail REST
allowance check. Admin usage reports can supplement evidence but lag behind events.
Do not add scopes, create a script, change accounts or raise provider quotas to
manufacture a capacity signal.

Keep one provider attempt per invocation and at least 60 seconds between attempts,
or slower when required. Google's [error guidance](https://developers.google.com/workspace/gmail/api/guides/handle-errors)
provides retry times for mail-limit responses and backoff for time-based errors.
This executor conservatively halts on an exception after the provider boundary,
records an unknown delivery and never automatically resubmits it. Preserve that
rule: reconcile the original attempt, respect any retry time, and require permitted
operator recovery before continuing. Successful API acceptance is not proof of
delivery; retain individual receipts and verify Sent, exclusions and failures.

The create request remains limited to 32 KiB, including recipient-specific copy.
Copy-heavy requests may therefore need fewer recipients. Frozen pilot data also
has a 512 KiB creation budget to leave room for later review metadata. Exceeding
either byte bound requires separately reviewed windows; neither bound silently
drops people. The UI can select the current available snapshot without a numeric
ceiling, but that action neither approves nor queues future arrivals. The frozen
recipient array is the finite work queue; a worker claims only its next eligible
entry. Each subsequent window uses the same completed-parent and exact-approval
workflow. The complete registry scan and reporting limits still fail closed; this
change does not claim unlimited data scanning or automatic successor approval.

Completed predecessors and the original campaign lock are immutable. An atomic
follow-on lock prevents parallel successor batches and stale workers. Durable
campaign invitation records exclude previously invited people and addresses,
including changed addresses or merged CRM identities. Never clear a lock or
delete a receipt to make a batch available.

The activation view resolves the current batch and completed predecessor from
their exact campaign locks, independently of the displayed history page. History
is paged in bounded document-ID order, not globally by creation time. Changing
pages must not change which batch can be reviewed, approved or launched.
Invitation-ledger exclusions cover the bounded workspace history, including
people and addresses outside the displayed page; incomplete or malformed
evidence blocks preparation rather than silently dropping duplicate protection.

New pilots freeze their greeting before audience approval. Uncertain labels
such as a nameless contact, honorific, reversed name or recognized organization
use the neutral greeting **Hi there,**. Review the displayed frozen greeting
alongside the recipient. Existing pilots keep their previously approved
greetings and fingerprints; this does not rename a CRM person or change consent.

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

Metadata requests share a 60-second budget at the existing concurrency of 10;
OAuth and database latency are outside that fetch budget.
Incomplete reads stay partial/unknown; further refreshes continue across the exact
sent set without treating an uninspected thread as zero replies. A permission or
rate denial stops later waves; there is no automatic retry. Existing reporting
event bounds still fail closed as unknown if history exceeds them.

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
