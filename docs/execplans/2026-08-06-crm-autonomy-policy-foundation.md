# CRM autonomy policy foundation

## Goal

Add a fail-closed, persisted autonomy-policy contract for RT Solutions and Rosser Gallery without changing provider execution routes or dashboard UI.

## Scope

- Pure autonomy policy and provider-boundary decision helper.
- Authenticated, operator-allowlisted `GET`/`PUT` API.
- Firestore transaction, optimistic versioning, request idempotency, and audit history.
- Unit, API smoke, local-run, and Cloud Run deployment documentation.

## Safety invariants

- Unknown or missing configuration resolves to `assist`.
- The global kill switch overrides every mode.
- The most restrictive applicable mode wins.
- Protected external actions are never auto-approved.
- Consequential policy updates require a high-trust, narrowly scoped execution envelope.
- Firestore client access remains denied.

## Exclusions

- No provider route integration.
- No dashboard page or layout changes.
- No deployment or production data mutation.

## Status

- [x] Read repository and trust-governance instructions.
- [x] Add the pure policy contract and fail-closed decision helper.
- [x] Add authenticated/authorized Firestore persistence API.
- [x] Add optimistic concurrency, idempotency, audit history, and correlation logs.
- [x] Add unit and smoke coverage.
- [x] Run lint, focused unit/smoke tests, TypeScript check, diff check, and secret scan.
