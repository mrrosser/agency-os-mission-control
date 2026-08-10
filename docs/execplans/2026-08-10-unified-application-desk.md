# Unified Application Desk Integration

Status: Implementation complete; independent review and production release in progress
Created: 2026-08-10
Owner: Agency OS / Velvet Circuit

## Goal

Make the existing Application Review Desk available inside the Firebase Mission
Control that Marcus already uses at `leadflow-review.web.app`. Preserve the
existing Firebase login and the AI-Hell-Mary backend's workspace, capability,
fingerprint, idempotency, and preparation-only approval controls.

## Root Cause

The review desk was released only in the separate AI-Hell-Mary Cloud Run app.
Agency OS owns Firebase Hosting and had no `/dashboard/opportunities` route or
navigation entry. A Hosting rewrite, iframe, or browser-side cross-origin fetch
is not safe: the two Next.js apps have incompatible root `/_next` assets and
browser auth persistence is origin-scoped.

## Release Contract

- Add a native Agency OS `/dashboard/opportunities` page and mobile/desktop nav
  item.
- Reuse the logged-in Agency OS Firebase user.
- Use four explicit same-origin adapters for workspace list, review list,
  decision, and prepared-case import.
- Locally verify the Firebase token, then forward only Authorization,
  workspace ID, correlation ID, bounded idempotency data, content type, and a
  bounded JSON body to the fixed AI-Hell-Mary service origin.
- Keep all review data and authority checks in AI-Hell-Mary. Agency OS does not
  write those Firestore collections directly.
- Preserve dry-run -> exact-three-case confirmation -> apply. Never auto-import.
- Keep RT review read-only while the canonical capable RT workspace and the
  separately owned RT workspace remain unreconciled.
- Do not add discovery, browser/form execution, final submit, payment,
  signature, attestation, terms acceptance, account changes, or communications.

## Definition of Done

- [x] Confirm the active Firebase site/revision/source and reproduce the 404.
- [x] Implement native navigation, page, strict workspace loading, and narrow
  server adapters in a clean worktree.
- [x] Pass focused proxy, route, UI, mobile navigation, type, lint, build,
  dependency, diff, and secret gates.
- [x] Obtain independent security/release review.
- [ ] Deploy through the Agency OS preview -> exact revision -> live Hosting
  promotion workflow.
- [ ] Verify live `/dashboard/opportunities` returns 200, the menu entry is
  present on mobile, and unauthenticated adapter access returns 401.
- [ ] Verify the authenticated Marcus queue and prepared-case preview without
  applying the import automatically.

## Rollback

Use the existing Agency OS Firebase/Cloud Run fail-closed deployment rollback
to restore the prior exact serving revision and Hosting version. The release
does not migrate or duplicate review data, so UI rollback requires no data
rollback. AI-Hell-Mary remains the data-plane authority throughout.

## Pre-Release Evidence

- Focused Vitest: PASS, 4 files / 18 tests after the RT read-only and exact
  upstream-path hardening.
- Full Vitest suite: PASS.
- TypeScript (`--noEmit --incremental false`): PASS.
- Full ESLint: PASS.
- Production Next.js build: PASS, 98 routes including the native
  `/dashboard/opportunities` page and four explicit adapter routes.
- Mobile Playwright: PASS at 412 x 915, Application Desk visible and active in
  the drawer, review card rendered, zero horizontal overflow.
- Dependency audit: PASS at the high/critical release threshold; 10 moderate
  transitive `uuid`-chain advisories remain and require a breaking dependency
  downgrade to auto-fix.
- Changed-file Gitleaks scan: PASS, 16 files, zero findings.
- Independent security/release review: PASS after closing the RT write-authority
  gap and enforcing the exact upstream-path allowlist inside the proxy helper.
