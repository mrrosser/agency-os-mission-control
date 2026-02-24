# ExecPlan: Scheduled Telemetry Retention Cleanup

Date: 2026-02-24

## Goal
Add a time-based retention policy for telemetry so Firestore telemetry collections are pruned on a schedule without manual intervention.

## Scope
- Add a retention cleanup script for telemetry collections.
- Add a scheduled GitHub Action to run cleanup daily.
- Add unit tests for config parsing and cleanup behavior.
- Persist cleanup run summaries to Firestore for operational visibility.
- Add authenticated status/dispatch APIs + Operations surface for cleanup metrics and alerts.
- Document local run + policy knobs.

## Non-Goals
- Firestore-native TTL policy migration.
- Deleting non-telemetry collections.
- Any autonomous code changes from telemetry findings.

## Implementation
1. Add `scripts/telemetry-retention-cleanup.js`:
   - Configurable retention windows.
   - Batch delete loop with hard max deletes per collection per run.
   - Structured logs with `correlationId`.
2. Add workflow `.github/workflows/telemetry-retention-cleanup.yml`:
   - Daily schedule.
   - Uses Firebase service account secret.
3. Add tests `tests/unit/telemetry-retention-cleanup.test.ts`:
   - Config validation.
   - Dry-run behavior.
   - Non-dry-run batched deletion behavior.
4. Update `README.md` + `package.json` script.
5. Add `GET /api/telemetry/retention-status` and `POST /api/telemetry/retention-run`, then show metrics/alerts/controls in Operations.

## Verification
- `npx vitest run tests/unit/telemetry-retention-cleanup.test.ts`
- `npx vitest run tests/unit/telemetry-sanitize.test.ts tests/unit/telemetry-fingerprint.test.ts`
- `npx vitest run tests/smoke/telemetry-error-route.test.ts tests/smoke/telemetry-groups-route.test.ts tests/smoke/telemetry-retention-status-route.test.ts tests/smoke/telemetry-retention-run-route.test.ts`

## Status
- [x] Cleanup script added.
- [x] Scheduled workflow added.
- [x] Tests added.
- [x] Firestore status persistence + status API + alerting surface + run-now dispatch API/UI added.
- [x] Docs and local run commands updated.
