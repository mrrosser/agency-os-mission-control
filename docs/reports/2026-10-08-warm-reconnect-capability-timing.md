# Warm reconnect capability preparation timing

An approved campaign stopped before its first provider attempt when its claim and capability transactions took more than one second. The executor calculated a 90-day expiry before those transactions, then required almost the entire 90 days to remain at receipt preparation. Normal Firestore latency exhausted that one-second allowance.

Capability issuance and receipt preparation now bind expiry to the durable delivery claim timestamp plus the existing 90-day lifetime. Preparation requires safe integer timestamps, an exact expiry match, a positive claim timestamp, and a preparation time between claim and expiry. Existing current-approval, exact audience, active lock, reserved invitation, receipt binding and distinct digest checks remain mandatory. No TTL extension, retry, provider fallback or runtime setting change is introduced.

Regression tests call the real receipt transaction function against an in-memory Firestore adapter. They accept 1.5-second and ten-second preparation latency and reject shifted, nonfinite or fractional expiry, future or invalid claims, expired authority and equal capability digests without writing a receipt. A separate executor test binds issuance to claim time, and the worker-route smoke test verifies that a pre-provider stop remains a stop even with HTTP 200. External APIs are mocked.

## Local execution and release

Use Node 22, `npm ci`, and `npm run dev` for local work. Focused validation:

```sh
npx vitest run tests/unit/warm-reconnect-executor.test.ts tests/smoke/warm-reconnect-executor-route.test.ts --maxWorkers=2
```

Required gates are lint, unit tests, smoke tests, production build, `npm audit --audit-level=high`, and Gitleaks. Run standalone TypeScript as an additional static check. Gate outcomes are recorded in `docs/reports/latest-run.md`.

Publish through the normal protected PR checks, merge to main, and use the existing Firebase Hosting merge workflow. Verify the serving Cloud Run revision and unchanged worker identity, provider flag and runtime bindings before any authorized invocation. No direct deployment or IAM/database repair is required by this patch. Rollback is a source revert through the same workflow; retain all delivery receipts and claims.

## Recovery of the known pre-provider stop

Preserve the stopped pilot, immutable dispatch claim, delivery receipt and its `stopped_before_provider` outcome. Reconcile that no provider timestamp or sent message exists and that the invitation and initial-pilot lock were released by the existing transaction as `released_before_provider`.

After the fixed release is verified, ordinary exact-five preparation with a fresh idempotency key may create a new pilot. The existing repository retains `priorPilotId` in the replacement active lock; invitation reservation increases its generation through the supported transaction. Do not clear records or replay the old dispatch. Reconfirm the same people and content and obtain fresh application approval/launch records; new decision and pilot IDs legitimately change audience/action fingerprints. An inflight, sent or unknown provider outcome remains excluded from this recovery.
