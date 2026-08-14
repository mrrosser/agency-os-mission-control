# AICF operational retirement

## Goal

Retire AICF / AI Co-Foundry as an active Agency OS business lane and make
RT.Solutions the current replacement without rewriting historical records.
Current create, approval, dispatch, lead-run, voice, agent, and scheduler
surfaces must fail closed for the retired identifiers.

## Confirmed production state

- `revenue-automation-aicf` is enabled in `leadflow-review/us-central1`, while
  the replacement `revenue-automation-rts` job is already enabled. The legacy
  job must be removed, not remapped, to avoid duplicate RT.Solutions work.
- `revenue-weekly-brain` still includes `aicf-south-day1` in its payload.
- Firestore contains historical AICF lead runs and templates. Those IDs are
  immutable audit provenance and must not be renamed or deleted by this change.
- Historical AICF social drafts exist, including pending approvals. Approval
  and dispatch paths must not turn them into new external actions.
- The deployed Google profile registry has RT.Solutions and Rosser Gallery
  profiles and no AICF profile.

## Scope and safety boundary

- Keep `ai_cofoundry`, `aicf`, `AICF-DISCOVERY`, and legacy template/job IDs
  readable where required for historical records and cleanup inventories.
- Remove them from active schemas, selectors, defaults, seed manifests, agent
  registration, and scheduler payloads.
- Reject attempts to activate a historical AICF lead template or approve an
  AICF social draft. Never silently relabel an old record as RT.Solutions.
- Do not deploy, change live Scheduler/Cloud Run/Firestore, modify Google OAuth
  work, or mutate the OpenClaw VM as part of this code-only change.
- The Settings UI and Firebase deployment workflows are concurrently owned by
  the Google OAuth repair and are follow-up gates rather than overlapping edits.

## Implementation checklist

- [x] Separate active RT.Solutions/Rosser registries from retired historical
  identifiers and add reusable retirement guards.
- [x] Default current CRM, lead sourcing, template, operations, social, and
  backfill paths to RT.Solutions; reject explicit AICF inputs.
- [x] Hide retired lead templates by default while retaining an authenticated
  historical-read option.
- [x] Fail closed before lead-run, revenue-template, social approval/dispatch,
  voice, or agent execution can perform external work for AICF.
- [x] Exclude historical AICF leads and KPI decisions from current closer-queue
  and service-lab creates while retaining them in retrospective memory.
- [x] Remove AICF from all owned scheduler/setup/seed/audit manifests; keep old
  job names only in removal/rollback inventories.
- [x] Remove owned AICF-only runtime readiness/environment fallbacks.
- [x] Add focused unit and smoke coverage, then run TypeScript, lint, and diff
  checks in proportion to the shared worktree.

## Verification completed

- Twenty-two focused unit and smoke test files pass across revenue, scheduler,
  CRM, social, agent, voice, lead-run, and historical-template behavior.
- ESLint completed with no errors. The sole remaining warning at that point was
  in a concurrently owned Google OAuth test, outside this change.
- `npx tsc --noEmit --incremental false` passes on the combined worktree. The
  retry took longer than usual while parallel build workers shared the Windows
  host, but completed cleanly.

## Production cutover gates

1. Merge with the Google OAuth repair, then remove the remaining AICF voice
   profile controls from the concurrently owned Settings page.
2. Run `scripts/revenue-automation-scheduler-setup.ps1` in its protected
   `Finalize` phase. Confirm `revenue-automation-aicf` is absent and
   `revenue-weekly-brain` contains only `rts-south-day1` and
   `rng-south-day1`.
3. In the OpenClaw VM change window, pause legacy AICF timers first, replace
   active route/default/template ownership with RT.Solutions, verify dry-run
   routing, and only then remove obsolete timer/config entries. Do not rewrite
   completed receipts or historical IDs.
4. Dual-deploy the `ai-cofoundry-mcp-hub` Cloud Run service under a new
   RT.Solutions resource name, cut over `LEADOPS_MCP_*` URL and OIDC audience,
   verify both paths, then retire the legacy service. The old hostname is a
   stable infrastructure ID until this gate is complete.
5. Verify pending historical AICF social approvals cannot approve or dispatch;
   the worker should record `retired_business_key` without an external call.

## Firestore retirement completed

On 2026-08-14, the post-deploy Firestore retirement was applied in one
update-time-guarded transaction under correlation ID
`a59f98b6-ad32-4c1a-88d8-45ac595cc499` and deterministic operation key
`aicf-operational-retirement-v1`.

- Four matching templates were archived, deactivated, and marked retired.
- Nine genuinely pending AICF drafts were operationally rejected and retired.
- Three approved/dispatched and three already-rejected drafts were verified by
  exact content/update-time hashes and left untouched.
- The transaction committed 13 target updates, 13 restricted exact-prior
  snapshots, and one aggregate-only receipt. Client Firestore Rules deny access
  to the receipt collection.
- No queue, provider, OAuth, Scheduler, OpenClaw, or MCP action was invoked.
- Dry-run plan hash:
  `sha256:0428c8c20450b3f52d687df6bd5eaf973ce811d933f749fdfaa925a41ed18081`.
- Pre/post aggregate hashes:
  `sha256:5581df3947cefd7b3ddb3f8c34b6eb4b08aac3e11cba9e82d1b740c1ccc68c8f`
  and
  `sha256:fc89bd20e20698daa837826cfa502348185aa1a6b41f2bf706a520e29efd2ac2`.
- An independent idempotent reread verified all 13 current target hashes and all
  13 rollback snapshots without another write.

## Local verification

```powershell
npx vitest run tests/unit/revenue-offers.test.ts tests/unit/revenue-daily-automation.test.ts tests/unit/autonomy-runtime.test.ts tests/unit/agent-registry.test.ts tests/unit/revenue-cadence-audit.test.ts tests/unit/social-drafts.test.ts tests/unit/social-dispatch.test.ts
npx vitest run tests/smoke/crm-customers-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/twilio-routes.test.ts
npx tsc --noEmit --incremental false
npm run lint
git diff --check
```

## Deployment and rollback

Deploy through the existing protected workflow only after the Google OAuth
repair merges. Before deployment, capture Scheduler job descriptions and the
current SSR revision. Run the scheduler setup in its documented finalize mode
to remove the legacy AICF job and verify the weekly payload contains only the
RT.Solutions and Rosser Gallery templates.

Rollback code to the prior revision if active RT.Solutions or Rosser paths
regress. Do not restore `revenue-automation-aicf` while the RT.Solutions job is
enabled. Historical Firestore records and dispatched receipts are audit data
and are never deleted during rollback.
