# Post-Roadmap Audit (2026-02-14)

## Scope Of This Slice
- Google OAuth verification readiness (UX + docs only).
- Activation funnel tightening (First Scan Tour + Operations empty state).
- Org-level Do Not Contact (DNC) list + enforcement across outbound channels.
- Lead-run worker reliability fix (SMS-only runs should not require ElevenLabs).
- Follow-up sequencing (draft-first tasks + worker endpoint; no sends).
- Telemetry triage phase 3 (optional patch suggestions behind a feature flag).
- Brand/UI consistency pass (AfroGlyph journey icons).

## Verification Evidence
- RT loop: PASS (RUN_ID=20260214-084856-1197). See `docs/reports/latest-run.md`.
- Build: `npm run build` PASS (included in RT loop).
- Smoke: `npm run test:smoke` PASS (included in RT loop).
- Unit: `npm run test:unit` PASS (included in RT loop).
- Deploy: Firebase Hosting + SSR backend updated for `leadflow-review` (`https://leadflow-review.web.app`).

## Security / Compliance Evidence
- Vulnerability scan: `scan_repo.ps1 -IncludeSecrets` ran (run_id=8b0dd9d7-cd7b-4b4a-bd3e-ae178b06d74a).
  - Secrets scan: WARN (gitleaks not installed).
  - `npm audit` reports 2 low-severity transitive findings (`cookie` via `firebase-frameworks`). See `.security/reports/npm-audit.txt`.

## Shipped Changes
- OAuth verification help surface:
  - Added `/help/google-oauth` and linked it from Integrations and Google Workspace connect warnings.
  - Added operator checklist in `docs/compliance/google-oauth-verification.md`.
- Activation:
  - First Scan Tour now advances to the first incomplete step and treats Google connection as optional.
  - Operations shows a "Getting Started" empty state when there are no journeys/logs yet.
- DNC:
  - New org-level DNC list (API + UI) in Settings.
  - Enforced DNC checks in Gmail send/draft, Twilio send-sms/make-call, and the lead-run worker (prevents side effects and records skipped receipts).
  - Domain DNC entries now match subdomains (e.g. `sub.example.com` also checks `example.com`).
- Lead-run worker:
  - SMS-only path no longer incorrectly requires ElevenLabs.
- Brand/UI:
  - Lead Journey step icons use `AfroGlyph` variants (Source/Score/Enrich/Script/Outreach/Follow-up/Booking).
- Follow-ups:
  - Added follow-up task queueing + a worker endpoint to process due tasks by creating Gmail drafts (no sends).
  - Enforced DNC before drafting follow-ups.
- Telemetry triage:
  - Added optional "patch suggestions" section (code pointers + repro checklist) behind `TELEMETRY_TRIAGE_SUGGEST_PATCH=true`.
- Maintainability:
  - Extracted lead-run scheduling into `lib/lead-runs/worker/scheduling.ts`.
  - Extracted Operations leaf UI modules (templates + follow-up card).

## Residual Risks / Follow-Ups
- Google OAuth verification remains a process blocker for external users (domain + consent screen + verification submission).
- Follow-up automation still requires a scheduler (Cloud Tasks / cron) to process tasks without manual triggering.
- Install gitleaks locally for a real secrets gate (RT loop currently marks secrets scan as SKIP).
- Consider addressing `cookie` transitive advisory once upstream resolves without requiring a breaking change.
