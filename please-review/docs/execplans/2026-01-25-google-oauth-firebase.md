# ExecPlan: Google OAuth + Firebase/Cloud Run Enablement

## Goal
- Fix Google API auth flow, enforce secure server-side token handling, add structured logging + idempotency, and align Firestore rules/tests/docs with production requirements.

## Scope
- Server-side Google OAuth connect flow and token storage.
- Update API routes for auth, validation, structured logs, and idempotency support.
- Update client calls to use Firebase ID token authorization.
- Align Firestore rules with actual collections.
- Add unit + smoke tests with mocked external APIs.
- Update docs for local run and deployment.

## Plan
1) Baseline platform + cloud checks (Cloud Run artifacts, enabled APIs) and record gaps. [completed]
2) Implement server auth/logging/idempotency utilities and Google OAuth token store. [completed]
3) Update API routes and client calls to use server-side tokens and validated inputs. [completed]
4) Update Firestore rules and documentation. [completed]
5) Add unit + smoke tests with mocked external APIs. [completed]

## Progress Log
- 2026-01-25: Started baseline checks. Cloud Run service and Artifact Registry repo exist; Google APIs not enabled; enable attempt failed due to permissions.
- 2026-01-25: Added server-side Firebase Admin + Google OAuth token storage, updated API routes, and added structured logging + idempotency support.
- 2026-01-25: Updated client fetch calls to use Firebase ID token auth, added Google Workspace connect UI, and expanded Firestore rules.
- 2026-01-25: Added unit + smoke tests and updated README with local/deploy instructions.
