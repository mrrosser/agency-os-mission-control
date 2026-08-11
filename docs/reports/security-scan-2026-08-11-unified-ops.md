# Unified operations security scan — 2026-08-11

## Scope and result

- Repository: `mrrosser/agency-os-mission-control`
- Release base: `59763822a42b20c01042f1a0a126f52ad70b9374`
- Scanner: Gitleaks `8.30.0`, default rules, full reachable history
- Dependency gate: `npm audit --audit-level=high` passed with no high or
  critical finding; ten pre-existing moderate transitive findings remain.
- Changed-range Gitleaks scan: passed with no finding.
- Initial full-history scan: exit 1 with two findings.
- Final full-history scan after exact-fingerprint triage: passed; 203 commits,
  approximately 6.83 MB, zero unignored findings.

Final command:

```text
gitleaks git --log-opts="--all" --redact=100 --no-banner --no-color --report-format json
```

## Human triage

No matched value was printed, copied, hashed, or recorded. Both findings are
deterministic idempotency values in smoke-test fixtures. They are synthetic,
not credentials. No rotation or history rewrite is required.

## Baseline policy

`.gitleaksignore` contains only the two reviewed finding fingerprints. It has no
rule-wide, path-wide, regex-wide, or value-wide allowance. A future finding at
any other commit, file, line, or rule remains a hard failure.

Cisco skill and MCP scanners were not run because this release changes neither
the installed skill supply chain nor MCP server/tool source. Full tests,
TypeScript, changed-file ESLint, isolated production build, and diff checks are
recorded in the release ExecPlans.
