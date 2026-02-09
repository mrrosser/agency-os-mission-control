# ExecPlan: Telemetry + Triage Loop (Phase 1 + 2)

Date: 2026-02-09

## Goal
Automatically capture runtime errors from users (client + server), dedupe them, and trigger an automated triage loop that creates GitHub issues (and optionally PRs) with correlation IDs, logs, and actionable next steps.

This intentionally does **not** auto-merge to `main` by default.

## Non-Goals (for now)
- Fully autonomous “push-to-main and deploy” without human review.
- Storing raw secrets/PII in telemetry payloads.
- Full LLM-based patch generation (we leave hooks for it, but start rule-based).

## Architecture

### Phase 1: Capture + Store + Dedupe
- Client-side reporter:
  - Captures `window.onerror`, `unhandledrejection`, and React `ErrorBoundary` crashes.
  - Posts sanitized payloads to `POST /api/telemetry/error` with an `eventId` and `x-correlation-id`.
- Server-side capture:
  - `withApiHandler` records 5xx responses (optionally) into the same telemetry grouping, using the existing correlation ID.
- Storage:
  - Firestore collections:
    - `telemetry_error_groups/{fingerprint}`: aggregate counts + sample payload + triage status.
    - `telemetry_error_events/{eventId}`: individual events (bounded fields, clipped sizes).

### Phase 2: Triage Bot (Automated)
- A scheduled GitHub Action runs a triage script:
  - Reads untriaged groups from Firestore.
  - Creates GitHub issues with:
    - fingerprint
    - first/last seen
    - count
    - sample stack + correlation IDs
    - suggested remediation (rule-based classification)
  - Marks groups as triaged in Firestore.
  - Optional: PR creation is supported behind a feature flag and requires explicit enablement.

## Guardrails
- Input validation with Zod for all telemetry endpoints.
- Payload size limits and field clipping (avoid log/DB blowups).
- Rate limiting (best-effort) per IP + per session.
- Idempotency:
  - Event doc ID = `eventId`.
  - Group doc ID = stable `fingerprint` (SHA-256).
  - GitHub issue creation recorded on group doc to avoid duplicates.
- Secrets:
  - Never store tokens in telemetry.
  - Redact obvious credential patterns before persistence.

## Config / Secrets
Runtime (SSR service):
- `TELEMETRY_ENABLED=true`
- `TELEMETRY_SERVER_ERRORS=true` (optional; captures 5xx in `withApiHandler`)

GitHub Action (triage):
- Uses existing `FIREBASE_SERVICE_ACCOUNT_LEADFLOW_REVIEW` secret for Firestore access.
- Uses built-in `${{ github.token }}` to create issues.

## Implementation Steps
1) Add telemetry schemas + fingerprinting utilities (`lib/telemetry/*`).
2) Add `POST /api/telemetry/error` route (client error ingest).
3) Add optional server-error capture in `lib/api/handler.ts`.
4) Add client reporter component + wire into `app/layout.tsx` / `ErrorBoundary`.
5) Add triage script (`scripts/telemetry-triage.ts`) + unit tests.
6) Add scheduled GitHub Action workflow for triage.
7) Update `README.md` (local run + deployment + ops).

## Verification
- Unit tests: fingerprinting + sanitization + classification.
- Smoke: telemetry route returns JSON + `x-correlation-id` and stores group counts (Firestorm mocked).
- Manual: trigger a client error in dev, confirm Firestore group increments and triage workflow creates an issue.

