# Portfolio CRM read-only registry

## Operator surface

Open `/dashboard/crm`. The first panel is the canonical portfolio contact
registry. The revenue lead pipeline remains below it and continues to use its
existing routes and write lifecycle.

The registry panel shows only aggregate evidence:

- people and contact-point totals;
- email and phone contact-point counts;
- Rosser Gallery, RT Solutions, KGClassy, and unassigned segments;
- Google People, Google Sheets, Blinq, and other source counts;
- canonical permission events, suppressions, import conflicts, and freshness.

`Outreach blocked` is intentional. This read-only panel never grants send
authority, and missing canonical permission/suppression evidence is a hard stop.

## API contract

`GET /api/crm/registry/summary`

- Firebase ID token required.
- Query parameters are rejected.
- The source workspace is derived as `workspace_default_<authenticated UID>`.
- The workspace must be active and owned by the caller.
- Exactly one active owner/admin membership must match the same UID/workspace.
- Returns aggregate-only schema version 1.
- Returns `Cache-Control: private, no-store, max-age=0`.

There is no POST, PATCH, PUT, DELETE, import, review-list, or send route in this
slice.

## Required Firestore indexes

Create the three declared freshness indexes additively before deploying an
application revision that serves this route:

```powershell
gcloud firestore indexes composite create --project=leadflow-review --database='(default)' --collection-group=crm_people --query-scope=collection --field-config=field-path=workspaceId,order=ascending --field-config=field-path=updatedAt,order=descending
gcloud firestore indexes composite create --project=leadflow-review --database='(default)' --collection-group=crm_contact_points --query-scope=collection --field-config=field-path=workspaceId,order=ascending --field-config=field-path=updatedAt,order=descending
gcloud firestore indexes composite create --project=leadflow-review --database='(default)' --collection-group=crm_source_records --query-scope=collection --field-config=field-path=workspaceId,order=ascending --field-config=field-path=updatedAt,order=descending
```

Firestore generates the final `__name__ DESC` segment for these descending
indexes; the generated segment is recorded explicitly in the checked-in
manifest and its unit contract.

Wait until all three indexes report `READY`, then re-run a read-only probe for
each exact shape:

- `crm_people`: `workspaceId == <authenticated registry>` plus
  `updatedAt DESC`, limit 1;
- `crm_contact_points`: the same shape;
- `crm_source_records`: the same shape.

Do not promote the application while any index is building or missing. The
aggregate equality, array membership, type, status, source, brand, and
permission-state queries were live-probed successfully on 2026-08-11. The
freshness shapes returned `FAILED_PRECONDITION` before these index declarations
were added; this is a deployment prerequisite, not an application fallback.

For the 2026-08-11 release, all three CRM indexes reached `READY`, all three
exact freshness probes returned HTTP 200 with one freshness-valid result, and
the normalized live-versus-manifest inventory matched 6/6 with no missing or
extra indexes. Repeat this readiness check for future environments and releases.

Do not use a broad `firebase deploy --only firestore:indexes` for this release.
The checked-in manifest now includes the previously unmanaged live READY
`leads` composite (`userId`, `workspaceId`, `createdAt`) as well as the two
existing managed indexes, but any future broad reconciliation still requires a
fresh live-versus-manifest inventory to prevent accidental deletion.

## Failure handling

- `401`: missing or invalid Firebase authentication.
- `400`: unsupported query parameters.
- `403`: the exact source registry workspace is not owned by the caller.
- `409`: workspace/member integrity is ambiguous or not active.
- `500`: Firestore aggregate evidence could not be read.

Failures do not fall back to the lead projection or Paperclip. The UI leaves
outreach blocked and displays the correlation-backed error.

## Local verification

```powershell
npm ci
npx vitest run tests/unit/portfolio-crm-registry.test.ts `
  tests/unit/portfolio-crm-index-contract.test.ts `
  tests/unit/portfolio-crm-registry-ui.test.tsx `
  tests/smoke/portfolio-crm-registry-route.test.ts
npm run lint
npm run build
```

Use synthetic aggregate fixtures only. Never copy a live contact into a test,
log, screenshot, or issue.

The endpoint has a fixed cap of 26 Firestore read operations per request: two
access-integrity reads and 24 aggregate/freshness queries. It accepts no
caller-controlled workspace, filter, list, limit, cursor, or review-list
parameter.
