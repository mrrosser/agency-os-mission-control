# Project Audit (2026-02-13)

Repo: `agency-os-mission-control` (LeadFlow Mission Control)

## Current Quality Gates
- Local RT loop runner added (Windows): `scripts/loop/run.ps1`
- CI RT loop runner added (Linux): `scripts/loop/run.sh` + `.github/workflows/rt-loop.yml`
- Latest local run report: `docs/reports/latest-run.md`

## Verification Status (as of 2026-02-13)
- Lint: PASS (warnings only)
- Unit tests: PASS (`npm run test:unit`)
- Smoke tests: PASS (`npm run test:smoke`)
- Build: PASS (`npm run build`)
- Dependency scan: PASS (`npm audit --audit-level=high`)

## Security Notes
- `npm audit` previously reported vulnerabilities in transitive deps (`axios`, `qs`).
- Remediated via `npm audit fix` (lockfile updated); current `npm audit` reports 0 vulnerabilities.

## Remaining Gaps / Follow-ups
- Lint warnings:
  - Unused vars (calendar schedule, onboarding tour)
  - Hook dependency warnings (Lead Journey / Receipt Drawer)
  - `any` types in visuals backdrop component
  - Unused eslint-disable in `lib/calendar/slot-search.ts`
  These are non-blocking today but should be cleaned up to keep signal-to-noise high.
- Secrets scanning locally:
  - `scripts/loop/run.ps1` will run `gitleaks` if installed; otherwise it skips.
  - CI installs and runs `gitleaks` via `.github/workflows/rt-loop.yml`.
- External configuration (non-code):
  - Google OAuth consent screen / verification: if still in "Testing", non-test users will see `403 access_denied`.
  - Meta OAuth rotation (SocialOps context): waiting on Beth to accept invite before rotating app ID/secret in Secret Manager.

## Next Steps (recommended order)
1) Commit + push current work so CI runs the RT loop workflow.
2) Ensure Google OAuth consent screen is set to Production (or add required test users) for external testers.
3) After Beth accepts invite, rotate Meta app credentials in Secret Manager and re-run SocialOps connector smoke.

