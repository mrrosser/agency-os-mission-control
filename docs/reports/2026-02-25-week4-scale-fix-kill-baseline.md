# Week4 Scale/Fix/Kill Baseline (2026-02-25)

## Scope
- Completed the remaining 1-5 tasks for the revenue automation plan:
  1) scheduler payload update for control + variant templates,
  2) payload verification,
  3) Day30 smoke runs (daily + weekly brain),
  4) reliability alert audit,
  5) baseline scale/fix/kill snapshot.

## 1) Scheduler Payload Rollout (Control + Variant)

Updated Cloud Scheduler job payloads in `leadflow-review/us-central1` so each business loop now includes control (`A`) + experiment (`B`) templates.

- `revenue-day2-rts-loop` (`35 10 * * *`): `rts-south-day1`, `rts-south-day1-exp-b`
- `revenue-day2-rng-loop` (`30 10 * * *`): `rng-south-day1`, `rng-south-day1-exp-b`
- `revenue-day2-aicf-loop` (`45 10 * * *`): `aicf-south-day1`, `aicf-south-day1-exp-b`
- `revenue-day30-rts-daily` (`15 9 * * *`): `rts-south-day1`, `rts-south-day1-exp-b`
- `revenue-day30-rng-daily` (`15 9 * * *`): `rng-south-day1`, `rng-south-day1-exp-b`
- `revenue-day30-aicf-daily` (`15 9 * * *`): `aicf-south-day1`, `aicf-south-day1-exp-b`
- `revenue-day30-weekly-brain` (`20 6 * * 1`): all 6 template IDs above

Also updated scheduler setup tooling to support per-business template ID overrides:
- `scripts/revenue-day2-scheduler-setup.ps1`
- `scripts/revenue-day2-scheduler-setup.sh`
- `scripts/revenue-day30-scheduler-setup.ps1`
- `scripts/revenue-day30-scheduler-setup.sh`
- `docs/runbook-day2-revenue-automation.md`
- `docs/runbook-day30-revenue-automation.md`

## 2) Payload Verification

Decoded each scheduler job body after update and validated:
- payloads parse as valid JSON,
- `templateIds` include expected control + variant IDs,
- existing schedules remained intact.

## 3) Day30 Smoke Runs

Triggered both scheduler jobs manually:
- `revenue-day30-rts-daily`
- `revenue-day30-weekly-brain`

Cloud Scheduler status:
- both latest attempts succeeded (`status: {}`).

Cloud Run completion logs (`jsonPayload.message="revenue.day30.completed"`):
- `d9bec18a-3fbb-41fb-a8f0-d1a056c0dbca` (daily): `templatesSucceeded=2`, `leadsScored=10`, `warnings=0`
- `b690cd05-6433-44f7-a6ae-3646091babe2` (weekly): `templatesSucceeded=6`, `leadsScored=17`, `warnings=0`

Response loop error check:
- searched both correlation IDs for `responseLoopError`
- result: **not found** for both runs.

## 4) Reliability Alert Audit

Alert policies (enabled):
- `projects/leadflow-review/alertPolicies/17348220042341366209`
  - display: `Revenue Day30 OAuth Refresh Failures`
  - metric filter: `logging.googleapis.com/user/revenue_day30_oauth_refresh_failures`
- `projects/leadflow-review/alertPolicies/4208395024262107027`
  - display: `Revenue Day30 Scheduler Failures`
  - metric filter: `logging.googleapis.com/user/revenue_day30_scheduler_failures`

Notification channel:
- `projects/leadflow-review/notificationChannels/3874784829681145220`
- display: `MC Ops Email`
- email label: `mcool4444@gmail.com`
- both alert policies are wired to this channel.

## 5) Scale/Fix/Kill Baseline Snapshot

Source docs (Firestore latest):
- `identities/DM5ZZngePXXhNgN85Afi7W4Knoz2/revenue_kpi_reports/latest`
- `identities/DM5ZZngePXXhNgN85Afi7W4Knoz2/revenue_kpi_decisions/latest`
- `identities/DM5ZZngePXXhNgN85Afi7W4Knoz2/executive_brain/daily/entries/latest`

Weekly KPI baseline (`2026-02-23` -> `2026-03-01`):
- `scannedLeadCount=1`
- summary: all core revenue outcomes currently `0`
  - leads sourced, qualified, outreach ready, meetings, deposits, deals won, pipeline value
- decision summary:
  - `scale=0`
  - `fix=0`
  - `kill=0`
  - `watch=0`

Daily digest baseline (`dateKey=2026-02-25`):
- `templatesSucceeded=6`
- `leadsScored=17`
- `responseCompleted=0`
- `dealsWon=0`
- `pendingApprovals=0`

## Practical Decision Log (Now)

- `scale`: none yet (insufficient positive close/deposit signal).
- `fix`:
  - external enrichment capacity is constrained (Firecrawl 402 credit errors observed during both smoke runs).
  - run-level evidence:
    - daily run correlation had 10 error-severity log entries tied to Firecrawl credit exhaustion.
    - weekly run correlation had 21 error-severity log entries tied to Firecrawl credit exhaustion.
- `kill`: none yet (not enough historical volume to trigger deterministic kill rule).

## Immediate Follow-up

1. Refill/replace web enrichment capacity (or route enrichment fallback) before raising lead volume.
2. Keep Week3 variant loop running for a full week, then evaluate first real scale/fix/kill split from non-zero conversion data.
3. Re-run this baseline report after Monday KPI rollup to establish week-over-week trend.
