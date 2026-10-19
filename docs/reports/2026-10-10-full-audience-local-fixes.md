# Full-audience CRM preparation: local candidate

The CRM can now review a campaign whose current batch is outside the first history page. Its current controls come from exact campaign lock records and verified batch evidence. History remains a bounded display view, with 20 rows per page in document-ID order. This supports the planned nineteen follow-on batches plus the two existing pilots without guessing the current parent from list position or timestamps.

This is a local candidate based on `503e786a5c72bbc917596ce19590976d737c3719`, on `codex/crm-full-audience-fixes-20261010`. Publication, deployment and provider execution were not performed or authorized by this preparation task.

## Behavior and safeguards

- The initial lock, follow-on lock, current holder and exact predecessor are read independently of history pages in a read-only Firestore transaction. Missing, malformed, foreign or contradictory authority fails closed. A completed parent requires matching execution, receipt and ledger evidence.
- The authenticated activation endpoint accepts a single bounded `historyAfter` cursor. Pagination uses workspace/owner equality filters and explicit document-ID ordering. Both the history query and the follow-on existence query were checked against the production database through read-only, non-PII projections; both succeeded without index changes.
- Prior invitations are excluded by both person ID and email key using a complete bounded workspace ledger scan, independent of the visible page. The scan fails closed above 1,000 records or on malformed current-campaign evidence. This bound exceeds the planned campaign population and must be reviewed before a larger history accumulates.
- The UI uses server control IDs, displays frozen greetings and keeps the last successful display after a failed read. A separate freshness state disables campaign mutations after any failed activation read or any attempted campaign POST. Only a successful authoritative activation read clears that state; reconnecting the sender cannot clear it.
- A narrow greeting resolver runs only when creating a new pilot. Missing names, placeholders, honorifics, reversed-name punctuation and recognized organization labels use `Hi there,`. Current-audience parity is exactly ten intended changes and 366 byte-identical greetings. Existing stored pilots and fingerprints remain untouched.

Executor, batch reservation, invitation-ledger mutation, preference consumption, worker authentication and provider-send modules are byte-identical to the base commit. Approved copy, sender, consent confirmation, suppression, cadence and receipt semantics are unchanged. Contact relationship attestation permits the reviewed invitation workflow; it is not newsletter consent.

## Validation

Independent manual review found no blocking or unresolved findings. Final focused UI/history/provider/API verification passed 104 tests. Greeting and activation verification passed 55 tests, including legacy greeting preservation and Unicode names. History regressions cover 107 pilots, an off-page authoritative holder, sequence-19 completion, missing/malformed/released locks, conflicting receipts and the 1,000/1,001 ledger boundary.

Repository-wide verification passed:

- Full unit and smoke suite: **2,256 tests across 268 files**, zero failures or pending tests; 373.99 seconds with two workers.
- Standalone TypeScript and production build: passed. Provider sending remained disabled.
- Full lint: zero errors; two existing unused-catch-variable warnings in the unchanged Google callback route.
- Fresh official-registry dependency audit: zero high/critical and 18 moderate findings. Dependencies and the severity threshold are unchanged.
- `git diff --check`: passed. The complete patch packaging process verifies all thirteen independently reviewed source/test hashes, checks application against the exact base with a disposable index, and runs Gitleaks on the complete patch, including new files. Its final outcome and artifact hashes are recorded in the external manifest.

The first quiet full-suite run was interrupted before reporting a test outcome. The completed run above used the same suite and thresholds; no source or test changes were made between attempts. The completed runner emitted its passing summary only at the end. Raw logs, read-only query receipts, private audience parity and the independent source-hash manifest are retained outside the source checkout. No recipient identities or capability URLs are included in the patch.

## Local execution investigation

Ordinary Gmail access does not establish an application sender runtime. The repository documents local mocked verification with provider sending disabled; it contains no verified supported localhost CRM send operation. Existing operational helpers target the protected Cloud Run worker. Its OIDC audience must be an exact HTTPS `*.run.app` origin. Reusing a production-audience token against localhost is not an established operating procedure and was not attempted.

Preference consumers are source-compatible between the deployed revision and this baseline. Recipient capabilities are opaque random values whose SHA256-indexed bindings live in Firestore, not JWTs requiring a new signing key. Any supported executor must share the same database, exact approvals, sender profile, suppression and receipt controls, and a working public preference consumer.

At 2026-10-10 19:07:41 UTC, fresh token-free requests to both Hosting and the exact Cloud Run `/preferences` endpoints returned HTTP 503 from Google Frontend. Earlier Hosting homepage checks returned 200. Those observations establish a current dynamic-service availability blocker, not its billing root cause. Separate earlier deployment evidence records a billing-disabled release failure.

No local live server was started, sender credentials read, worker identity tokens minted, capability links generated, campaign locks changed or live provider calls made during this investigation. The next operational step is to restore and verify the public preference service, then use the supported protected release and execution workflow with its exact review and approval requirements. A separate local operating mode would require design and integration verification before execution could be considered.

See the [execution plan](../execplans/2026-10-10-full-audience-local-fixes.md) and [batch runbook](../runbook-warm-reconnect-batches.md).
