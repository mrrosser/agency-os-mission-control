# Unified Application Desk Lifecycle and RT Access Projection

Status: Implemented and locally verified in an isolated worktree; not merged or
deployed
Created: 2026-08-11
Owner: Agency OS / Velvet Circuit

## Goal

Project AI-Hell-Mary's deterministic overdue lifecycle into the existing
Mission Control desk, show clean workspace labels, and remove the redundant
Agency-side RT deny so exact upstream membership capability is the only review
decision authority.

## Release Contract

- Show server-retained days 1–5 in the normal queue and Expired filter.
- Show server-retained days 6–14 only in the Expired filter.
- Never show a `soft_archived` row, and never compute archive age from the
  browser clock.
- Render **Marcus Rosser Artist Career** and **RT.Solutions** only as display
  projections; do not change canonical IDs, slugs, or upstream names.
- Forward the fixed, bounded decision route for canonical RT exactly as for any
  other workspace. AI-Hell-Mary resolves and enforces the authenticated member
  capability.
- Do not mutate live Firestore, merge, deploy, import prepared cases, or execute
  any external application action in this slice.

## Verified Live Topology

Canonical RT is `ws_ee1735c095774325` / `rt-solutions`. Marcus UID
`DM5ZZngePXXhNgN85Afi7W4Knoz2` is active there with
`canApproveActions=false`. Marcus also owns `ws_36d5fe8544c643d0`, which is a
duplicate non-capable workspace and remains untouched.

As of 2026-08-11 12:00 CDT, AI-Hell-Mary contains 98 Marcus opportunities and
27 RT opportunities. The policy soft-hides 11 Marcus and 2 RT rows at day 15+;
one Marcus row at days 6–14 remains available in Expired. No record is deleted.

## Progress

- [x] Add lifecycle types and fail-closed staggered-release behavior.
- [x] Apply lifecycle-aware default/status filtering and server overdue labels.
- [x] Limit operator status choices to All / Needs Review / Expired while
  retaining granular approved, deferred, rejected, stale, and change-requested
  state on cards and in All.
- [x] Add exact friendly workspace label projection.
- [x] Remove only the local RT decision deny.
- [x] Bind smoke tests to Marcus's exact UID and canonical RT forwarding.
- [x] Keep prepared import restricted to the canonical Marcus workspace.
- [ ] Merge/deploy after both repositories' full gates and exact-head review.
- [ ] Apply the separate canonical RT membership capability update.

## Gates

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/application-desk.test.ts tests/smoke/application-desk-routes.test.ts tests/smoke/application-desk-ui.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false
node node_modules/eslint/bin/eslint.js lib/application-desk.ts app/api/application-desk/reviews/[reviewId]/decision/route.ts components/application-review-desk.tsx tests/unit/application-desk.test.ts tests/smoke/application-desk-routes.test.ts tests/smoke/application-desk-ui.test.ts
npx playwright test tests/playwright/application-desk.spec.ts
npm run build
git diff --check
```

Final isolated-worktree evidence on 2026-08-11: 3 focused files / 16 tests
passed; full TypeScript and scoped ESLint passed; Next.js 15.5.22 production
build passed with 98 static pages; staged gitleaks found no leaks; cached diff
check passed.

## Deployment and Rollback

Deploy AI-Hell-Mary's server lifecycle first. Agency OS fails closed if an older
upstream omits lifecycle metadata: expired rows are hidden from the default
queue rather than reclassified with a browser clock. While the canonical RT
capability is false, the new forwarding path remains read-only upstream.

After exact revision verification, a separately approved data operation may
merge only the canonical Marcus member's `canApproveActions=true`. Roll back RT
access by restoring that exact field to `false`; roll back UI/code using the
prior exact Cloud Run revision and Hosting version. Do not delete any workspace,
opportunity, review, or decision record.
