# Unified Application Desk Runbook

## Operator Path

1. Sign in at `https://leadflow-review.web.app/login`.
2. Open the mobile menu and choose **Application Desk**, or go directly to
   `https://leadflow-review.web.app/dashboard/opportunities`.
3. Filter by workspace, applicant track, lane, or the simplified **All**,
   **Needs Review**, and **Expired** status buckets.
4. Choose **Approve for preparation**, **Request changes**, **Defer**, or
   **Reject**.

Approval authorizes internal drafting and evidence gathering only. It does not
authorize opening/filling a provider form, final submission, payment,
signature, attestation, terms acceptance, account changes, or communications.

**Needs Review** groups actionable, stale, and change-requested rows. **All**
also keeps approved, deferred, and rejected history reachable; the card badges
and immutable decision receipts retain each exact granular status. **Expired**
is a lifecycle bucket and does not overwrite those card statuses.

## Overdue Queue Policy

AI-Hell-Mary derives the lifecycle from its server clock. Agency OS uses the
returned `deadlineLifecycle`; it does not calculate retention from the phone or
browser clock.

- 1–5 overdue days: visible in **All statuses** and **Expired**.
- 6–14 overdue days: visible only when **Expired** is selected.
- 15+ overdue days: soft-archived and omitted from the desk.

Soft archive is a read filter only. Opportunities, review state, and immutable
decision receipts remain stored. At the read-only 2026-08-11 12:00 CDT baseline,
this hides 11 of 98 Marcus opportunities and 2 of 27 RT opportunities; one
additional Marcus item remains available only in Expired.

## Load the Three Prepared Marcus Cases

The control appears only after the backend confirms Marcus has approval
capability in the canonical Artist workspace.

1. Choose **Load 3 prepared applications**.
2. Confirm that the dry-run preview lists exactly:
   - SUNO Nursing Building Interior
   - SUNO Nursing Building Exterior
   - Water Connects Us
3. Accept the confirmation only if those are the intended internal review
   records.

This does not submit anything. The system must not apply the import without the
explicit confirmation.

## Architecture and Safety

- Firebase Hosting and the native page are owned by `agency-os-mission-control`.
- Review data and decision enforcement remain owned by AI-Hell-Mary.
- Agency OS uses four fixed same-origin adapters; there is no generic proxy.
- Each adapter verifies the Firebase bearer token locally and forwards it only
  to the pinned AI-Hell-Mary Cloud Run service.
- Workspace IDs, review IDs, idempotency headers, request bodies, response
  bodies, redirects, and response content types fail closed.
- Tokens and decision notes must never be logged.
- Agency OS does not maintain a workspace-ID deny for review decisions. The
  upstream authenticated membership and `canApproveActions` capability are the
  sole authority; AI-Hell-Mary checks both its route and transaction.

The canonical RT topology verified read-only on 2026-08-11 is:

- workspace `ws_ee1735c095774325`, slug `rt-solutions`;
- Marcus UID `DM5ZZngePXXhNgN85Afi7W4Knoz2`, active membership,
  `canApproveActions=false`;
- duplicate workspace `ws_36d5fe8544c643d0`, owned by Marcus but not the
  canonical Artist Manager workspace.

The Agency adapter forwards canonical RT decisions, but the upstream returns
read-only until the exact canonical member capability is changed. Leave the
duplicate untouched. Never infer approval from login, a workspace label, slug,
or duplicate-workspace ownership.

## Local Verification

```powershell
npm ci
npm run test:unit
npm run test:smoke
npx playwright test tests/playwright/application-desk.spec.ts
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Use Playwright only with an existing authorized storage state or a dev/staging
login bypass. Never enable dev login in production.

## Deployment and Postdeploy

Merge only after the Agency OS PR checks pass. The repository's Firebase
workflow deploys a preview channel, verifies and promotes the exact Cloud Run
revision, rebinds the Hosting version, runs smoke checks, and clones the exact
preview release to `live`.

Postdeploy requirements:

- `/dashboard/opportunities` returns 200 through Firebase Hosting.
- Mobile navigation contains **Application Desk**.
- `/api/application-desk/reviews` without auth returns 401.
- The exact live Hosting version points to the exact verified Cloud Run tag.
- The authenticated Marcus workspace loads; no prepared import is applied
  during verification.
- Friendly display labels read **Marcus Rosser Artist Career** and
  **RT.Solutions** while the underlying IDs/slugs remain unchanged.
- Before any live RT capability change, verify the canonical RT response still
  reports `canDecide=false`. A separately reviewed change may merge only
  `capabilities.canApproveActions=true` into the exact Marcus member document.
