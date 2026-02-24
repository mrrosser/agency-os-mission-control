# Dependency Security Exceptions (2026-02-24)

## Remediation Pass Applied
- Updated runtime dependency graph and lockfile (`package-lock.json`) with:
  - `fast-xml-parser` -> `5.3.7` (patched; transitive via `@google-cloud/storage`)
  - `cookie` -> `0.7.2` via override on `firebase-frameworks`
  - `minimatch` -> `10.2.1` via override under `glob`
- Added `package.json` overrides:
  - `firebase-frameworks.cookie = 0.7.2`
  - `glob.minimatch = 10.2.1`
- Runtime gate command:
  - `npm audit --audit-level=high --omit=dev`
  - Result: **pass** (0 vulnerabilities in production dependency graph).

## Temporary Exceptions
1) `minimatch` (high) in dev lint toolchain
- Advisory: GHSA-3ppc-4f35-3m26
- Scope: dev-only path (`eslint` / `eslint-config-next` / `@typescript-eslint` chain).
- Current blocker: clean fix requires coordinated major lint stack upgrade.
- Compensating controls:
  - CI security gate runs runtime audit with `--omit=dev`.
  - Full `npm audit` remains reviewed during dependency update cycles.

2) `ajv` (moderate) in dev toolchain
- Advisory: GHSA-2g4f-4pwh-qvx6
- Scope: dev-only transitive path.
- Compensating controls:
  - No runtime exposure in production bundle.
  - Tracked for resolution during next lint/tooling dependency refresh.

3) Override compatibility exception
- `cookie@0.7.2` and `minimatch@10.2.1` are enforced ahead of upstream semver range updates in some transitive packages.
- Rationale: close runtime high-severity findings now.
- Exit criteria:
  - Remove overrides once upstream packages publish compatible ranges with patched versions.

## Owner / Review Cadence
- Owner: Mission Control engineering
- Review trigger:
  - Every dependency bump PR, or
  - Any audit severity increase/change.
