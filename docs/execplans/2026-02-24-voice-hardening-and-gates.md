# ExecPlan: Voice Hardening + Gate Reliability (2026-02-24)

## Goal
Ship the requested production hardening batch:
1) voice write actions default-off unless explicitly enabled in knowledge policy,
2) business-local time interpretation for transcript scheduling,
3) atomic voice worker claim + idempotent Gmail/Calendar execution path,
4) fail-closed post-deploy smoke for core lead-run routes,
5) short-lived control-plane billing cache,
6) dependency/security remediation pass (overrides + lockfile + documented exceptions).

## Scope
- Voice webhook + worker safety and deterministic behavior.
- Post-deploy smoke script correctness for release gating.
- Control-plane billing route performance guardrail (cache + in-flight dedupe).
- Dependency override pass and security exception documentation.

## Out of Scope
- Broad architecture rewrites.
- New product features unrelated to reliability/security hardening.
- External console/provider account changes.

## DoD Gates
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:smoke`
- [x] `npm run build`
- [x] `npm audit --audit-level=high --omit=dev`

## Task Checklist
- [x] Voice policy defaults and planning logic updated to explicit-enable behavior.
- [x] Voice request claim path made atomic.
- [x] Gmail draft + Calendar create paths guarded with idempotency keys.
- [x] Transcript date/time parsing and “tomorrow” interpretation use business timezone.
- [x] `/scripts/post-deploy-smoke.mjs` updated to fail closed for core route failures.
- [x] Billing pull path includes short-lived cache and in-flight request dedupe.
- [x] Dependency overrides + lockfile updated, with temporary exceptions documented.
- [x] Unit/smoke tests added or updated for all touched behavior.

## Verification Notes
- Keep diffs scoped and reversible.
- Mock external APIs in tests.
- Preserve structured logs/correlation IDs on touched routes.
