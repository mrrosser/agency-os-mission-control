# Google Account Worker Repair

## Objective

Restore the RT.Solutions and Rosser Gallery revenue workers after the Google
connection data was migrated from a single Firestore token document to the
OpenClaw schema-v2 multi-account registry and Secret Manager vault.

## Scope and safety

- Select `rt_solutions_work` for the `rt`/`rts` revenue lane and
  `rosser_gallery_work` for `rng`.
- Read and refresh OAuth tokens through Secret Manager; never copy token values
  into Firestore or logs.
- Fail closed when a requested profile is missing instead of using another
  connected account.
- Keep the legacy single-account reader as a compatibility fallback for callers
  that do not request a profile.
- Externalize `@google-cloud/tasks` so its runtime JSON assets are included in
  the server artifact, and ignore bind-all addresses as HTTP fallback targets.
- Preserve draft-first and per-item approval gates. This repair does not send
  email, submit applications, create meetings, or enable SMS/calls.

## Plan

1. Reproduce the worker failure and verify the schema-v2 registry, profile
   bindings, and Secret Manager records. Status: completed.
2. Add the scoped account-token adapter and organization profile selection.
   Status: completed.
3. Repair Cloud Tasks packaging and invalid fallback-origin handling. Status:
   completed.
4. Run unit, smoke, lint, type, build, and build-artifact checks. Status:
   completed.
5. Deploy a zero-traffic candidate, verify secret-binding parity and health,
   then promote and run one idempotent production smoke per lane. Status: in
   progress. The first candidate smoke reached both bound profiles and Cloud
   Tasks, then exposed that Firebase supplies `GCLOUD_PROJECT` to this helper;
   traffic was rolled back to `ssrleadflowreview-00285-r98` while that runtime
   compatibility fix is released.

## Local verification

```powershell
npm ci --no-audit --no-fund
npx vitest run tests/unit/google-account-token-store.test.ts tests/unit/google-oauth-account-tokens.test.ts tests/unit/lead-run-jobs-trigger.test.ts tests/smoke/revenue-automation-daily-worker-task-route.test.ts
npx eslint lib/google/account-token-store.ts lib/google/oauth.ts lib/lead-runs/jobs.ts 'app/api/lead-runs/[runId]/jobs/worker/route.ts' next.config.ts tests/unit/google-account-token-store.test.ts tests/unit/google-oauth-account-tokens.test.ts tests/unit/lead-run-jobs-trigger.test.ts
npx tsc --noEmit --incremental false --pretty false
npm run build
```

After the build, verify the lead-worker NFT trace includes
`@google-cloud/tasks/**/cloud_tasks_client_config.json` and that compiled server
chunks contain no absolute local build path.

## Deployment and rollback

Deploy through the repository Firebase PR/main workflows so protected runtime
configuration remains sourced from GitHub secrets. Before traffic promotion,
compare all existing Secret Manager references with the active revision and
verify `/api/health` on a zero-traffic tag. Preserve
`ssrleadflowreview-00285-r98` as the immediate Cloud Run rollback revision.

After promotion, create exactly one forced run for each lane with distinct
correlation IDs. Require successful account-profile selection, worker
completion without `Google account not connected`, and released concurrency
slots. If verification fails, route 100% traffic back to
`ssrleadflowreview-00285-r98`; do not repeat a forced run until Firestore and
logs prove whether the first request created one.
