# AICF Firestore operational retirement

This one-purpose operator retires only the confirmed production AICF records in
`leadflow-review`:

- four `lead_run_templates` whose explicit `params.businessUnit` is
  `ai_cofoundry` or whose explicit `outreach.businessKey` is `aicf`, provided
  they are not already archived or retired;
- nine `social_drafts` whose explicit `businessKey` is `aicf`, whose status is
  still draft/pending, and which have neither a final approval nor any dispatch
  evidence.

The operator requires the exact production aggregate of 4 templates, 9 pending
drafts, 3 approved/dispatched drafts, and 3 rejected drafts. Any schema or state
drift aborts before a write. It never calls a queue or external provider.

## Safety model

- The project binding is hard-pinned to `leadflow-review`.
- A fresh dry-run plan hash is required for apply.
- Apply uses one Firestore read/write transaction and update-time preconditions.
- The same transaction stores 13 exact prior document snapshots plus an
  aggregate-only receipt under
  `operational_retirement_receipts/aicf-operational-retirement-v1`.
- Firestore Rules deny all client access to that collection; only the Admin/API
  credential used by this operator can access the rollback material.
- Existing fields are retained. The operator adds retirement metadata, archives
  the templates, and records an operational rejection on the pending drafts.
- The three dispatched/approved and three already-rejected historical drafts
  are content- and update-time-hash protected and remain untouched.

## Local verification

```powershell
npx vitest run tests/unit/aicf-firestore-retirement.test.ts
npx tsc --noEmit --incremental false
npx eslint lib/operations/aicf-firestore-retirement.ts tests/unit/aicf-firestore-retirement.test.ts
git diff --check
```

## Production dry-run and apply

Use a short-lived access token only through an environment variable. Never
print or persist the token.

```powershell
$retirementAccessToken = gcloud auth print-access-token
$env:AICF_FIRESTORE_ACCESS_TOKEN = $retirementAccessToken
node --no-warnings --experimental-strip-types scripts/aicf-firestore-retirement.mjs --project-id=leadflow-review --dry-run
Remove-Item Env:AICF_FIRESTORE_ACCESS_TOKEN
$retirementAccessToken = $null
```

Re-read production immediately before apply, copy only the returned aggregate
plan hash, then run:

```powershell
$retirementAccessToken = gcloud auth print-access-token
$env:AICF_FIRESTORE_ACCESS_TOKEN = $retirementAccessToken
node --no-warnings --experimental-strip-types scripts/aicf-firestore-retirement.mjs --project-id=leadflow-review --apply --confirm=sha256:PLAN_HASH
Remove-Item Env:AICF_FIRESTORE_ACCESS_TOKEN
$retirementAccessToken = $null
```

The apply result must report 27 committed writes: 13 target updates, 13
restricted rollback snapshots, and one receipt. It must also report zero queue
and provider actions and verify all six protected historical records.

## Deployment and rollback

The operator is not part of the web runtime and requires no Cloud Run deploy.
Commit it through the protected repository workflow so future audits retain the
exact procedure used.

Rollback is a separately approved production action. The restricted snapshot
documents contain the original Firestore field maps, target paths, and prior
update times needed to reconstruct all 13 records exactly. Do not restore AICF
as an active lane while RT.Solutions is active; use the receipt only to recover
from an incorrect data mutation.
