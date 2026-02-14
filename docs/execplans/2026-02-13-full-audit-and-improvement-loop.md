# ExecPlan: Full Audit + Improvement Loop (2026-02-13)

## Goal
Run a full product + code audit, capture actionable findings, and execute a tight improvement loop without feature creep.

## DoD (Verification Gates)
- [x] RT loop passes: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/loop/run.ps1`
  - Pass criteria: report ends with `end status=PASS` in `docs/reports/latest-run.md`
- [x] Security scan report updated: `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/CTO Projects/CodexSkills/.codex/skills/vuln-scan-remediate/scripts/scan_repo.ps1" -Path . -IncludeSecrets`
  - Pass criteria: `.security/reports/npm-audit.txt` updated and no high findings introduced
- [x] Audit report created/updated: `docs/reports/2026-02-13-full-audit.md`
  - Pass criteria: includes prioritized findings + next actions
- [x] At least 5 quick win improvements shipped (small diffs), each with a test or verification note.
- [x] (Optional but recommended) UI smoke: `npm run test:pw`

## In Scope
- Codebase audit: security, reliability, performance, maintainability, UX regressions.
- Competitor gap scan: identify 5-10 high-leverage feature gaps to prioritize.
- Quick wins: fixes that reduce user friction and production risk (errors, validation, caching, rate limits, UX clarity).

## Out of Scope (No Feature Creep)
- New product modules (CRM rebuild, full email sequencer, new payment system).
- Any change requiring secrets committed to git.
- "Auto-fix bugs by auto-committing to main" (unsafe; will remain human-reviewed).

## Milestones
1) Baseline gates + reports (RT loop + vuln scan)
   - Evidence: `docs/reports/latest-run.md`, `.security/reports/*`
2) Audit inventory + findings write-up
   - Output: `docs/reports/2026-02-13-full-audit.md`
3) Quick wins batch (5+)
   - Target: remove lint warnings, reduce wasted API calls, tighten validation, UX affordances.
4) Competitor gap scan
   - Output: section in audit report with prioritized "build next" list.
5) Verify gates again and prep for push/deploy

## Primary Files / Areas
- API routes: `app/api/**/route.ts`
- Lead Engine UI: `app/dashboard/operations/page.tsx`, `components/operations/*`
- Google integrations: `lib/google/*`, `components/integrations/*`
- Onboarding: `components/onboarding/*`, `lib/onboarding/*`
- Logging/telemetry: `lib/api/handler.ts`, `lib/logging.ts`, `app/api/telemetry/*`

## Risks / Watchouts
- OAuth verification constraints are largely policy/process; mitigate with clearer UX and fallbacks (Places-only flows).
- Places photo thumbnails can amplify network requests; ensure lazy-loading and caching.
- Firestore rules must match any new reads/writes (avoid "works locally, fails in prod").

## Shipped In This Loop
- [x] Google Places photo thumbnail client: lazy-load + concurrency cap + blob cache.
- [x] First Scan Tour replay: Settings entry point + force-show flag for existing users.
- [x] Operations page refactor: split into smaller view components (no behavior change).
- [x] Booking clarity: record + render explicit `no_slot` receipts; expand lead contact candidates with confidence tags.
- [x] Deploy reliability: fix Firebase deploy helper on Windows (`npx` spawn / `EINVAL`).
