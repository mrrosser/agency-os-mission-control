# ExecPlan: Auto Follow-up Worker (Cloud Tasks)

Date: 2026-02-15

## Goal
Automatically process due follow-up tasks (draft-first) without requiring a user to click "Process due", using Cloud Tasks for scheduling and org-level controls for rate-limiting.

## Non-Goals
- Sending emails (we only create Gmail drafts).
- Building a global cron that scans all runs.
- Backfilling existing historical follow-up tasks (can be triggered by re-queueing or a one-time admin script later).

## Design
- Add a Cloud Tasks-callable worker route: `POST /api/outreach/followups/worker-task`
  - Auth: per-run `followupsWorkerToken` stored on `lead_runs/{runId}`.
  - Worker resolves `uid` from the `lead_runs/{runId}.userId` field.
- Add org-level settings stored at `lead_run_org_followups/{orgId}`:
  - `autoEnabled`
  - `maxTasksPerInvocation`
  - `drainDelaySeconds`
- Scheduling strategy:
  - When follow-up drafts are queued, schedule the worker for the earliest pending `dueAtMs`.
  - When the worker finishes, it self-schedules for the next pending `dueAtMs`.
  - If Cloud Tasks is not configured, the worker only triggers immediate execution (never schedules far-future work) to avoid tight loops in local dev.

## Environment Variables
Add to Cloud Run/Firebase frameworks SSR runtime:
- `FOLLOWUPS_TASK_QUEUE`
- `FOLLOWUPS_TASK_LOCATION`
- `FOLLOWUPS_TASK_SERVICE_ACCOUNT` (optional; Cloud Tasks OIDC)
- `FOLLOWUPS_TASK_DELAY_SECONDS` (optional; default 0)
- `FOLLOWUPS_AUTO_ENABLED` (default true)
- `FOLLOWUPS_MAX_TASKS_PER_INVOCATION` (default 5)
- `FOLLOWUPS_DRAIN_DELAY_SECONDS` (default 30)

## Definition of Done
- Queueing follow-ups arms the scheduler when `autoEnabled=true`.
- Worker route rejects invalid `workerToken`.
- Worker processes due tasks with `maxTasksPerInvocation` cap.
- Worker schedules the next invocation if pending tasks remain.
- Settings UI reads/writes org settings.
- Smoke tests cover queue scheduling + worker-task auth.

## Verification
Local:
- `npm run test:smoke`
- Manual: queue follow-ups and confirm `scheduledNextAtMs` is returned and logs show `outreach.followups.worker_enqueued` when Cloud Tasks vars exist.

Deploy:
- `npm run deploy:firebase`

