---
name: socialops-audit
description: Run security audits and smoke tests across SocialOps repos (socialops-client, socialops-orchestrator, socialops-portal). Use when asked to run vulnerability scans, multi-tool audits, or produce security readiness summaries.
---

# SocialOps Audit

## Overview
Run consistent dependency + secrets scans and validate core smoke tests for SocialOps services.

## Quick start
- Scan a repo: `scan_repo.ps1 -Path <repo> -IncludeSast -IncludeSecrets -IncludeContainerScan`
- Apply safe fixes: `fix_repo.ps1 -Path <repo>` (AllowMajor default)
- Re-scan and run tests.

## Workflow
1) Identify repos: `socialops-client`, `socialops_orchestrator`, `socialops_portal`, `socialops-cua-runner` (if present).
2) Run scans with `scan_repo.ps1`. For non-git dirs, run `gitleaks detect --no-git -s .` and save to `.security/reports`.
3) Apply fixes with `fix_repo.ps1` where dependency files exist.
4) Re-run scans and capture updated reports.
5) Run tests:
   - `socialops-client`: `npm run test`, `smoke_test_mock.ps1` (mock)
   - `socialops_orchestrator`: `pytest` or `smoke_test.ps1` (if configured)
   - `socialops_portal`: `smoke_test.ps1`
6) Summarize findings and residual risks.

## Notes
- Semgrep is not available on Windows; record it as skipped SAST.
- Bandit can flag `node_modules`; treat as false positives.
- Never paste secrets in reports; use Secret Manager or env vars.
