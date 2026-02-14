# Full Audit Report (2026-02-14)

## Baseline Evidence
- RT loop: PASS (RUN_ID=20260214-000359-9214). See `docs/reports/latest-run.md`.
- Dependency scan:
  - `npm audit --audit-level=high` passes (RT loop gate).
  - Full `npm audit` reports 2 low-severity transitive findings (`cookie` via `firebase-frameworks`). See `.security/reports/npm-audit.txt`.
- Secrets scan: skipped (gitleaks not installed) via `scan_repo.ps1` (CodexSkills).

## Delta Since Last Audit (2026-02-13)
- Runtime: Firebase frameworks SSR function upgraded to Node.js 22 (2nd Gen).
- Deploy reliability: frameworks deploy now omits dev dependencies via `NPM_CONFIG_OMIT=dev` (prevents Windows/Next build flakes and reduces bundle size).

## Findings (Prioritized)

### P0 (Blocking / user-visible break)
1) Google OAuth verification still blocks Drive (and other sensitive scopes) for external users.
   - Impact: users can sign in, but Drive-based Knowledge Base connection may fail with “access denied / app not verified”.
   - Fix is process + policy (domain ownership + consent screen + verification submission), not code.

### P1 (High leverage UX + reliability)
1) Lead run templates: tolerate longer natural-language “Lead Query” descriptions.
   - Symptom: users saw “Invalid request body” when saving templates.
   - Root cause: API schema capped `query` at 120 chars while UI encourages longer ICP descriptions.
   - Fix shipped in code: accept up to 500 chars and cap Places search query to a safe prefix.
2) Maintainability hot-spots remain:
   - `app/dashboard/operations/page.tsx` (~2.6k LOC)
   - `app/api/lead-runs/[runId]/jobs/worker/route.ts` (~1.3k LOC)
   - Recommendation: continue incremental extraction with regression tests (no “big bang” rewrite).

### P2 (Risk / tech debt / polish)
1) Residual low-severity transitive vuln (`cookie` via `firebase-frameworks`) remains.
   - Fix requires a breaking change (`npm audit fix --force` wants a downgrade).
   - Accept for now; revisit once Firebase frameworks resolves upstream.
2) Branding/UI backlog items are not tracked in repo docs yet (icons + visual system consistency).

## What’s Left In The Plan (Current Roadmap)

### Blockers (must-do)
1) Google OAuth verification + custom domain
   - Buy/verify a domain; move Hosting to custom domain.
   - Host Privacy Policy + Terms on that domain and set consent screen links.
   - Submit verification for requested sensitive scopes (Drive/Gmail/Calendar as needed).

### Activation + onboarding
1) “First scan” guided tour is in place; next step is tightening the activation funnel:
   - Add explicit “Connect Google (optional)” step for Drive/Calendar/Gmail with scope presets.
   - Add a visible “Run your first scan” CTA state when no leads exist.

### Lead data quality + enrichment
1) Continue expanding enrichment/verification (pragmatic, not vendor-heavy):
   - Optional: add email deliverability verification step (even a lightweight DNS/SMTP pattern check first).
   - Optional: expand Places Details fields and surface more in the drawer.

### Outreach workflow
1) Draft-first follow-ups / sequencing (minimal viable):
   - Follow-up scheduler that creates Gmail drafts (no send) with timing + status receipts.
   - Unsubscribe/“do not contact” list per org.

### UX polish
1) Replace default icon set with a consistent brand icon pack (afrofuturism direction requested).
2) Ensure login/hero visuals are readable across devices and do not block interaction (perf + contrast).

### Telemetry loop (phase 3+)
1) Optional: add “suggested patch” automation behind a feature flag:
   - Generate a PR draft from high-signal telemetry groups, but keep human review mandatory.
   - Do not auto-deploy from bot actions.

