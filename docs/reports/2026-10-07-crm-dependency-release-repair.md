# CRM dependency release repair

The CRM recovery PR passed application tests, but its protected release check stopped at high/critical dependency advisories. This follow-up updates the affected packages and preserves the audit threshold. Campaign source, recipients, approved content, sender bindings, consent, fingerprints, expiry checks, locks and provider authority are unchanged.

## Changes and upstream evidence

| Package | Before | After | Reason |
| --- | --- | --- | --- |
| sharp | 0.35.4 | 0.35.5 | [Upstream security release](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) ships librsvg 2.63.2; the existing shared sharp override is retained. |
| proxy-addr | 2.0.7 | 2.0.8 | [Patched proxy trust handling](https://github.com/advisories/GHSA-jqcg-44mw-7w3h); compatible transitive lock update. |
| source-map-js | 1.2.1 | 1.2.2 | [Patched indexed-map exhaustion handling](https://github.com/advisories/GHSA-68fv-2mgg-jv7q); compatible transitive lock update. |
| Vitest, development only | 3.2.6 | 4.1.11 | [Patched 4.x release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11) removes Tinypool and fixes the mocker advisory. |
| Vite, development only | 7.3.6 transitive | 7.3.6 explicit | Retains the already tested bundler version while updating Vitest; avoids an unrelated Vite 8 migration. |

All available Vitest 3 releases still depend on Tinypool 1.x, while the [Tinypool fix](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) starts at 2.1.2. Upgrading to the supported Vitest 4 release avoids forcing an incompatible Tinypool major into Vitest 3. The [official migration guide](https://v4.vitest.dev/guide/migration) supports this repository's Node 22/Vite 7 combination. Vitest 5 and npm's proposed Firebase downgrade are unnecessary here.

The final lock keeps Next 15.5.25, Vite 7.3.6 and PostCSS 8.5.26 unchanged. Other version changes belong to the updated Sharp native packages or the Vitest dependency tree. No Tinypool installation remains. Linux Sharp/libvips package records are present for the CI/runtime platform; the actual local native binding reports Sharp 0.35.5 and librsvg 2.63.2.

The worktree previously reused another task's node_modules through a junction. Only this worktree's junction was detached, and a fresh owned installation was created with `npm ci`. The shared target still retains its original Vitest 3.2.6 and Sharp 0.35.4. No other checkout's dependency installation was changed.

## Validation

- Fresh official-registry audit after the final clean installation: **zero critical, zero high, fifteen moderate**. The original gate `npm audit --audit-level=high` passes without an exception.
- Four new offline runtime smoke checks exercise proxy trust refusal, correctly trusted proxies, bounded indexed source-map exhaustion and Sharp's actual SVG-to-PNG native resize/color path.
- The bounded before-version probes reproduce the old proxy trust error and old source-map text corruption. These are behavioral regression checks, not only package-version assertions. The source-map fixture uses just a 128-line offset and causes no load test.
- Production build passed (91 generated static pages); standalone TypeScript passed. Full lint passed with zero errors/two existing callback warnings, and final changed-file lint is clean.
- Vitest 4 migration preserves every assertion and explicit mock restoration. `clearMocks: true` supplies the per-test call-history cleanup formerly provided by `restoreAllMocks`; eight constructor fixtures across five files now use constructable functions and return the same fixture objects. No production source change was required.
- Final complete suite: **1,808/1,808 tests passed across 258 files, zero pending**, using two workers with no competing build/typecheck/lint process. This includes all recovery, sender, approval, executor and four new runtime dependency cases.
- Initial migration failures are preserved as evidence. After the fixture/config updates, a concurrent-check run had one existing 21-rule ESLint guard timeout at 21.75 seconds. In the final full run it passed in 2.52 seconds under its unchanged 20-second limit. The guard and all assertions remain intact.
- All 409 tracked files under `app`, `lib`, `components` and `public` are unchanged from the reviewed recovery head (Git blob equivalence allowing checkout CRLF). This includes the exact campaign source and pinned artwork.
- Independent read-only review found no blocking change in the dependency ranges, fixture behavior or mock restoration. Final scoped Gitleaks and whitespace checks accompany the commit handoff.

Validation artifacts are retained outside public source under `RNG_Artist_Projects/output/CTO_Projects/CRM_NextBatch_20261007/dependency-repair-validation/`. Earlier recovery validation and audit evidence remain preserved separately.

## Run, release and rollback

Use Node 22 and run `npm ci`. Run `npx vitest run tests/unit tests/smoke`, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `npm audit --audit-level=high`. The new dependency smoke file is `tests/smoke/dependency-runtime-security.test.ts`. All tests use fixtures or mocked external services; no real send is needed for validation.

This updates existing PR #60. The unchanged protected Firebase PR/main workflows remain the release path. Root reviews the completed candidate before a merge or deployment. No live pilot recovery, approval, launch or provider send is part of this dependency repair. After release, use the [ordinary recovery workflow](../warm-reconnect-expired-launch-review.md) for the same saved pilot; content/send approval is still separate.

If a dependency causes a regression, prepare a reviewed source revert or replacement release through the same workflow. Do not waive the security gate to redeploy the vulnerable lock. Preserve campaign records, lock ownership, receipts and recovery events throughout rollback. The fifteen remaining moderate advisories are not claimed fixed by this scoped release repair.
