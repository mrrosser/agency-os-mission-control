# Warm reconnect provider executor

## Safety posture

The worker route is `POST /api/jobs/warm-reconnect`. It processes at most one
recipient per invocation and accepts only the exact five-person pilot already
reviewed, approved, and moved to `launch_requested`. The separate operator
launch is the authority to deliver that exact approved pilot; it is not merely
a draft or staging request.

Provider infrastructure remains dormant by default even after that authority is
recorded. `WARM_RECONNECT_PROVIDER_SEND_ENABLED` must be exactly `true` before
an authorized route can claim a recipient. Do not set that flag during
ordinary web deployment. No scheduler is installed by this slice, so recording
launch authority alone does not start an automatic cadence.

Every run:

- requires the existing Cloud Run scheduler OIDC identity; legacy worker-token
  mode is rejected;
- recomputes the frozen pilot fingerprints and checks the unexpired approval,
  exact sender profile/address, exact five recipients, and all verified gates;
- reloads the canonical contact, source evidence, permission events, import
  conflicts, canonical suppression ledger, and legacy email/domain DNC entries;
- requires the exact Gmail-send profile grant (email identity plus
  `gmail.send`, with no broader Gmail/Drive/Calendar scopes);
- normalizes a bounded workspace contact scan (maximum 500 email contacts) and
  requires exactly one canonical email match; a truncated scan or mixed-case /
  whitespace duplicate stops execution;
- normalizes a bounded workspace suppression scan and fails closed on a
  matching or truncated suppression registry;
- reserves a deterministic workspace + campaign-version + person + email-key
  invitation ledger entry in the same transaction as the delivery claim;
- permanently excludes `sent` and `delivery_unknown` ledger entries across all
  later pilots, before capabilities or Gmail can be called;
- binds each provider transition to the active initial-pilot lock and releases
  that lock and a clean reservation only on a terminal pre-provider stop;
- renders the frozen approved recipient `greetingName`, not a mutable current
  person-record name;
- creates separate preference and one-click-unsubscribe capabilities with a
  90-day expiry, storing only their digests in the delivery receipt;
- allows at least 60 seconds between provider attempts; and
- stops the pilot on drift or uncertainty. A Gmail exception is recorded as
  `delivery_unknown` and is never retried automatically.

Logs and audit events contain correlation IDs, stable internal IDs, counts, and
fingerprints. They do not contain OAuth credentials, contact email addresses, or
preference capabilities.

## Local verification

Keep the provider flag unset. Run the focused mocked tests and static checks:

```powershell
npx vitest run tests/unit/warm-reconnect-executor.test.ts tests/smoke/warm-reconnect-executor-route.test.ts --maxWorkers=1
npx eslint lib/crm/warm-reconnect-executor.ts lib/crm/warm-reconnect-invitation-ledger.ts app/api/jobs/warm-reconnect/route.ts tests/unit/warm-reconnect-executor.test.ts tests/smoke/warm-reconnect-executor-route.test.ts
npx tsc --noEmit --pretty false --incremental false
```

The tests mock every Gmail/provider boundary. Do not use a live Google access
token for local verification.

## Deploy dormant

Use the repository deployment path:

```powershell
npm run build
npm run deploy:firebase
```

Verify that `WARM_RECONNECT_PROVIDER_SEND_ENABLED` is absent or not `true` in
the deployed SSR service and that no Cloud Scheduler job targets the worker.
The route must authenticate scheduler OIDC before disclosing disabled state;
an authorized probe then returns a no-store `503` without parsing a pilot body
or performing provider work.

## Separate activation change

Enabling delivery is a later, explicit operational change. Before that change:

1. Verify a launched pilot still contains exactly five individually attested
   recipients and a current 24-hour approval.
2. Verify the selected Google profile exposes only the needed Gmail send scope,
   its stored account email equals the approved `From` address, and replies are
   monitored.
3. Verify SPF, DKIM, DMARC, the legal sender, physical postal address, artwork
   approval, public preference page, one-click unsubscribe, canonical
   suppression ledger, and legacy DNC mapping.
4. Configure the existing revenue automation scheduler service account and
   exact Cloud Run OIDC audience. Do not enable legacy-token fallback for this
   route.
5. Enable the provider flag for a bounded canary and invoke the route once per
   task. Observe the durable receipt before scheduling another invocation at
   least 60 seconds later.

If a receipt is `delivery_unknown`, the pilot must remain stopped until a human
reconciles Gmail. Never replay that recipient automatically.

## Rollback

Unset `WARM_RECONNECT_PROVIDER_SEND_ENABLED` first. Remove or pause any scheduler
created by the separate activation change. Preserve pilots, preference tokens,
receipts, suppressions, and audit events for reconciliation; do not delete them
during rollback.
