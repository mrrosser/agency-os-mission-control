# CRM Assistant release: refreshed dependency gate

Correlation ID: `crm-assistant-release-20260908`. This is a compatible security-patch continuation of Marcus's approved publication, not a new feature or authority expansion.

## Evidence and scope

PR48 merged as `4db26c165ba01875475c413bebbcdda83843f4e4` after all checks passed, including 1,114 tests. During production run `34284929466`, a fresh audit changed from the earlier zero-high/critical result to four high and one critical dependency findings. The run was canceled while `npm run build` was active. Google authentication, Firebase deployment, runtime update and promotion all finished **skipped**. Live CRM therefore remains the earlier verified PR47 release.

The advisory database was updated September 8. Correct the previous frozen audit claim rather than bypassing the high-severity gate. Use a separate worktree/branch `codex/crm-assistant-release-patch-20260908`, based on merged PR48, with its own dependencies. Never modify the shared dependency junction of earlier worktrees.

## Small compatible changes

- Next.js and its matching ESLint config: 15.5.22 to 15.5.25.
- Sharp: 0.35.3 to 0.35.4, preserving the existing nested `$sharp` override.
- Refresh locked transitive xmldom and js-yaml within their existing dependency ranges to patched versions; no broad forced audit fix or Firebase framework downgrade.
- Add `npm audit --audit-level=high` immediately after install in PR and production workflows, before build or cloud authentication, with regression tests.
- No CRM application behavior, voice models, routes, owner scope, contacts, email gates, secrets, database rules or API credentials changed.

## Verification / release

- [ ] Lockfile diff contains only compatible patch updates and their necessary matching native/compiler packages; fresh audit zero high/critical.
- [ ] New isolated install, full test suite, lint/typecheck/build, and mocked Assistant desktop/mobile checks pass.
- [ ] Required protected PR checks pass before normal exact-head merge; no admin bypass.
- [ ] Existing production workflow publishes the patched feature and verifies preserved integration settings/flags and exact Hosting/runtime binding.
- [ ] Fresh live anonymous checks and sanitized runtime receipt pass; OpenAI key remains an explicit API Vault setup requirement, not claimed as tested speech.

Assistant repository switches are true for approved manual use; they create no sessions by themselves. No key was found for the eligible workspace owners or runtime fallback, and no credential payload was inspected. No real AI request or email send occurs as a release test.

## Primary advisory references

- [Next.js AVIF image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
- [Next.js Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
- [Sharp/libheif advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
- [js-yaml advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)
