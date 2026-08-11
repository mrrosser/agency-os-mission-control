# Portfolio CRM read-only unification

## Goal

Expose the existing canonical portfolio contact registry in the native Mission
Control CRM without copying contacts, changing ownership, or authorizing
outreach. Keep the existing lead pipeline visibly separate.

## Verified production baseline

- Canonical registry data lives in Firestore collections prefixed `crm_` and is
  scoped to the authenticated operator's legacy default workspace.
- The current `/api/crm/customers` surface reads a separate lead projection and
  does not expose the canonical registry.
- The canonical registry contains permission and suppression collections, but
  the observed live state has no canonical permission events or suppressions.
  Therefore this slice must report outreach as blocked.
- Paperclip customer storage is not configured in the serving Mission Control
  revision and is not a source for this slice.

## Safety invariants

- GET only. No import, migration, delete, send, draft, approval, or provider
  action is added.
- Derive the registry workspace from the verified Firebase UID; never accept a
  caller-supplied registry workspace ID.
- Require the exact workspace document to be active and owned by the caller,
  plus exactly one active owner/admin membership for the same UID/workspace.
- Return aggregate counts only. Do not read or return contact names, addresses,
  email values, phone values, source payloads, or message content.
- Fail visibly. Never fall back to `leads`, Paperclip, or another workspace.
- Responses are `private, no-store`; logs contain only aggregate counts,
  a generic source-scope label, and correlation IDs.
- The UI always labels this surface read-only and outreach-blocked. It remains
  separate from the editable lead pipeline.

## Implementation

- [x] Add a versioned aggregate response contract.
- [x] Add exact legacy workspace ownership/membership verification.
- [x] Add Firestore aggregate queries for totals, sources, brands, permission
  posture, conflicts, and freshness.
- [x] Add `GET /api/crm/registry/summary` with no query parameters or fallback.
- [x] Add a responsive aggregate panel above the existing lead pipeline.
- [x] Add unit, smoke, and mobile-relevant UI coverage.
- [x] Declare and test the three exact workspace/freshness composite indexes.
- [x] Run focused and full repository gates.
- [x] Commit the frozen branch without pushing or deploying.

## Verification

```powershell
npm ci
npx vitest run tests/unit/portfolio-crm-registry.test.ts `
  tests/unit/portfolio-crm-index-contract.test.ts `
  tests/unit/portfolio-crm-registry-ui.test.tsx `
  tests/unit/crm-responsive-ui.test.ts `
  tests/smoke/portfolio-crm-registry-route.test.ts
npm run lint
npm run test:unit
npm run test:smoke
npm run build
npm audit --audit-level=high
git diff --check
```

Run `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD"` when the
binary is available. Tests use synthetic aggregate data and mocked Firestore;
they never contain imported contact values.

### Live read-only query proof (2026-08-11)

The release probe executed the production query shapes without printing contact
values, document payloads, workspace IDs, or timestamps:

- workspace-scoped total counts: passed;
- workspace plus `relationshipBrandIds array-contains` and
  `array-contains-any`: passed;
- workspace plus contact `type`, conflict `status`, source system, permission
  state, and permission basis filters: passed;
- workspace plus `updatedAt DESC`, limit 1, for `crm_people`,
  `crm_contact_points`, and `crm_source_records`: failed with
  `FAILED_PRECONDITION` because the composites were absent.

This branch now declares the three exact `COLLECTION` indexes in
`firestore.indexes.json`: `workspaceId ASC`, `updatedAt DESC`, and generated
`__name__ DESC`. Deployment must create them and wait for `READY`; then the
same read-only freshness probes must pass before the application revision is
promoted. The manifest also imports the existing live READY `leads` composite
(`userId ASC`, `workspaceId ASC`, `createdAt DESC`, generated `__name__ DESC`)
so source control is a live-state superset. Provision the CRM indexes with the
three exact additive `gcloud firestore indexes composite create` commands in
the runbook; do not use broad Firebase index reconciliation without a fresh
live-versus-manifest audit. No index or application deployment is performed by
this branch.

### Coordinated index readiness recheck (2026-08-11)

The release coordinator provisioned the three indexes additively outside this
branch and independently rechecked them:

- `crm_people` (`CICAgJjF9oIK`): `READY`;
- `crm_contact_points` (`CICAgJj7z4EK`): `READY`;
- `crm_source_records` (`CICAgJiUsZIK`): `READY`;
- each exact `workspaceId == canonical` plus `updatedAt DESC`, limit 1 probe:
  HTTP 200, result count 1, freshness valid;
- normalized live-versus-manifest inventory: 6/6 exact, zero missing, zero
  extra, all ready.

No contact values, document payloads, workspace IDs, or freshness timestamps
were printed by the probes. The application itself remains undeployed by this
branch.

## Verification results

Completed in the isolated worktree on 2026-08-11:

- focused CRM/index checks: 5 files, 18 tests passed;
- full ESLint: passed;
- full TypeScript (`--noEmit --incremental false`): passed after the final
  bounded-query refactor;
- full unit suite: 104 files, 451 tests passed;
- full smoke suite: passed;
- production Next.js build: passed and emitted
  `/api/crm/registry/summary` plus `/dashboard/crm`;
- `npm audit --audit-level=high`: passed with no high/critical findings; eight
  pre-existing moderate transitive `uuid` findings remain, and the suggested
  force fix would require a breaking Firebase Admin upgrade;
- `git diff --check`: passed;
- Gitleaks changed-path scan: 14 files scanned, passed;
- authenticated CRM Playwright project selection: two tests were discovered
  (desktop Chromium and mobile Chrome) and skipped because the optional test
  credentials were not present; mobile behavior remains covered by the unit
  source contract and server-rendered responsive component test.

The CRM index prerequisite is satisfied. No live data, application, message,
contact, consent, suppression, or provider state was mutated by this
implementation or its tests; coordinated additive index provisioning is
recorded separately above.

## Deployment and rollback

This branch is intentionally not pushed or deployed in this task. After review,
deploy through the existing Firebase/Cloud Run workflow. Post-deploy checks must
confirm unauthenticated `401`, authenticated aggregate counts, `Cache-Control:
private, no-store`, no contact values in the response, and no writes to any
`crm_*` collection.

Rollback by reverting this commit and redeploying the prior revision. Do not
delete, rewrite, or move registry records as part of rollback.
