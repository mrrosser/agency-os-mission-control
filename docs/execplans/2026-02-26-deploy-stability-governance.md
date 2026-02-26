# ExecPlan: Main Deploy Stability + Governance Reset (2026-02-26)

## Goal
Close the remaining deployment reliability and governance gaps:
1) make post-deploy smoke resilient to transient lead-run concurrency contention,
2) replace invalid rollback command with a supported Firebase Hosting promotion flow,
3) restore strict branch protection after pipeline stabilization,
4) add regression tests around deploy argument normalization for promotion commands,
5) run a full PR verification loop and capture the result.

## Scope
- `scripts/post-deploy-smoke.mjs`
- `.github/workflows/firebase-hosting-merge.yml`
- `tests/unit/firebase-deploy-args.test.ts`
- `README.md`
- GitHub branch protection settings for `main`

## Out of Scope
- Business logic changes in lead sourcing/scoring.
- New production features unrelated to deployment reliability.

## DoD Gates
- [x] `npm run lint`
- [x] `npm test`
- [x] deployment arg regression tests updated
- [x] docs updated with deploy flow changes
- [ ] main branch protection re-locked to strict settings after green verification PR

## Implementation Notes
- Smoke retries only apply to known transient 429 contention from lead-run job start.
- Deployment no longer pushes directly to `live`; smoke must pass before promotion.
- Failed smoke leaves `live` untouched (no unsafe rollback command).

## Local Verify
- `npm run lint`
- `npm test`
- `npx vitest run tests/unit/firebase-deploy-args.test.ts`

## Deploy / CI Verify
- Open PR with these changes.
- Confirm both required checks pass.
- Merge to `main`.
- Confirm merge workflow passes with smoke + promotion.
- Re-apply strict branch protection:
  - required checks: `test`, `build_and_deploy`
  - required approvals: `1`
  - enforce admins: `true`

## Progress
- [x] Added smoke retry/backoff for transient lead-run concurrency 429 responses.
- [x] Switched main deploy workflow to preview-channel deploy + smoke + promote.
- [x] Added regression tests for `hosting:channel:deploy` + `hosting:clone` arg paths.
- [x] Updated README deploy section.
- [ ] Run final PR verification + restore strict branch protection.
