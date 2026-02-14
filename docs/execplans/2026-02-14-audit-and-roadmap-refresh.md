# ExecPlan: Audit + Roadmap Refresh (2026-02-14)

## Goal
Run a fresh audit pass, capture current blockers + backlog, and ship small reliability fixes without feature creep.

## DoD (Verification Gates)
- [x] RT loop passes: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/loop/run.ps1`
  - Evidence: `docs/reports/latest-run.md` ends with `end status=PASS`
- [x] Security scan report updated:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File "C:/CTO Projects/CodexSkills/.codex/skills/vuln-scan-remediate/scripts/scan_repo.ps1" -Path . -IncludeSecrets`
  - Evidence: `.security/reports/npm-audit.txt` present and reviewed
- [x] Audit report created: `docs/reports/2026-02-14-full-audit.md`

## In Scope
- Re-audit product surface: auth, operations lead engine, templates, drive picker, telemetry triage.
- Confirm deploy/runtime status (Node 22 frameworks SSR).
- Fix clear user-facing validation issues (small diffs + tests).

## Out of Scope
- Full Google OAuth verification workflow execution (requires domain + console work).
- Major refactors of Operations page and worker route (only incremental extraction).

## Shipped In This Loop
- [x] Template save reliability: allow longer lead query descriptions; cap Places search query prefix.

