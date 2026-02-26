# Security + Compliance Sweep (2026-02-26)

## Scope
- Secrets exposure scan in tracked source files.
- Secret Manager presence check for production runtime secrets.
- Dependency audit scan/remediation.
- Local verification gates after remediation.

## Commands run
- `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' --glob '!*.lock' "(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|sq0atp-[A-Za-z0-9_-]{20,}|sq0csp-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AIzaSy)"`
- `gcloud secrets list --format="value(name)"`
- `npm audit --json`
- `npm audit fix --package-lock-only`
- `npm audit --json`
- `npm run lint`
- `npm test`

## Findings
- **Source secret literal scan:** no active credentials found in app source; one expected dummy token fixture in `tests/unit/telemetry-sanitize.test.ts`.
- **Secret Manager inventory:** required mission-control runtime secrets are present for social worker tokens, revenue worker tokens, Google Places, Firecrawl, and Square webhook signature verification.
- **Dependency audit (before remediation):** 3 dev-only findings (`ajv` moderate, `minimatch` high, `rollup` high).
- **Dependency audit (after remediation):** 0 vulnerabilities (`npm audit fix --package-lock-only` + re-audit).
- **Post-remediation verification:** `lint` and full `test` suite pass.

## Artifacts changed
- `package-lock.json` updated by npm audit lockfile remediation.

## Compliance status
- **Pass** for current repository checks.
- Residual note: continue external secret rotation cadence in Secret Manager runbooks; no repo-embedded secrets detected.
