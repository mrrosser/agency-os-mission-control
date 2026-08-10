# Unified Application Desk Runbook

## Operator Path

1. Sign in at `https://leadflow-review.web.app/login`.
2. Open the mobile menu and choose **Application Desk**, or go directly to
   `https://leadflow-review.web.app/dashboard/opportunities`.
3. Filter by workspace, applicant track, lane, or review status.
4. Choose **Approve for preparation**, **Request changes**, **Defer**, or
   **Reject**.

Approval authorizes internal drafting and evidence gathering only. It does not
authorize opening/filling a provider form, final submission, payment,
signature, attestation, terms acceptance, account changes, or communications.

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
- RT remains read-only until its duplicate workspace/capability configuration
  is explicitly reconciled.

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
