# RT Infinite Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a global, repeatable “RT Infinite Loop” workflow (skills + playbooks + shell gates) that can be reused across projects under `C:\CTO Projects`.

**Architecture:** Use `C:\CTO Projects\CodexSkills` as the global system-of-record for shared Codex skills, and a dedicated `rt-infinite-loop` repo for the reference playbook + templates. Each project opts in via a small local `AGENTS.md` + `skills_playbook.md` and a deterministic loop runner script invoked locally and in CI.

**Tech Stack:** Windows + PowerShell for ops, Node 20 repos (Next.js/Vitest/Playwright where applicable), GitHub Actions for CI, MCP servers via stdio/HTTP as needed.

---

## Milestone 1: Global Skills (System of Record = CodexSkills)

### Task 1: Inventory Existing Global Skills + Conventions

**Files:**
- Read: `C:\CTO Projects\CodexSkills\AGENTS.md`
- Read: `C:\CTO Projects\CodexSkills\skills.md`
- Read: `C:\CTO Projects\CodexSkills\skills_playbook.md`
- Read: `C:\CTO Projects\CodexSkills\.codex\skills\*\SKILL.md`

**Step 1: Capture findings**
- Create: `docs/reports/rt-infinite-loop-global-inventory.md`

**Step 2: Verify**
- Run: `Get-ChildItem -Path "C:\\CTO Projects\\CodexSkills\\.codex\\skills" -Directory`
- Expected: list of existing shared skills.

### Task 2: Add “Foundry” Skills To CodexSkills

**Files:**
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-boot\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-plan\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-build\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-test\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-shell-ops\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-security-scans\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-compaction-state\SKILL.md`
- Create: `C:\CTO Projects\CodexSkills\.codex\skills\foundry-apps-sdk\SKILL.md`
- Modify: `C:\CTO Projects\CodexSkills\skills.md`

**Step 1: Create minimal SKILL.md skeletons**
- Each skill must include:
  - When to use / when not to use
  - Step-by-step procedure
  - Stop conditions (hard gates)
  - Outputs (files produced)
  - Negative examples / edge cases
  - Verification commands (lint/tests/scans)

**Step 2: Add to global index**
- Add these skill names under “Shared skills” in `C:\CTO Projects\CodexSkills\skills.md`.

**Step 3: Verify**
- Run: `Get-ChildItem -Path "C:\\CTO Projects\\CodexSkills\\.codex\\skills" -Directory | Select-Object -ExpandProperty Name`
- Expected: `foundry-*` directories present.

### Task 3: Create A Global “RT Infinite Loop” Playbook Entry

**Files:**
- Modify: `C:\CTO Projects\CodexSkills\skills_playbook.md`
- Create (repo): `C:\CTO Projects\rt-infinite-loop\skills_playbook.md`

**Step 1: Add the new playbook path to the wrapper**
- Add `C:\CTO Projects\rt-infinite-loop\skills_playbook.md` under “Known playbooks”.

**Step 2: Verify**
- Run: `Select-String -Path "C:\\CTO Projects\\CodexSkills\\skills_playbook.md" -Pattern "rt-infinite-loop"`
- Expected: line exists.

---

## Milestone 2: RT Infinite Loop Repo (Reference Playbook + Templates)

### Task 4: Create The `rt-infinite-loop` Repo Skeleton

**Files:**
- Create: `C:\CTO Projects\rt-infinite-loop\AGENTS.md`
- Create: `C:\CTO Projects\rt-infinite-loop\README.md`
- Create: `C:\CTO Projects\rt-infinite-loop\skills_playbook.md`
- Create: `C:\CTO Projects\rt-infinite-loop\docs\apps-sdk\testing.md`
- Create: `C:\CTO Projects\rt-infinite-loop\docs\tools\shell.md`
- Create: `C:\CTO Projects\rt-infinite-loop\docs\security\scans.md`
- Create: `C:\CTO Projects\rt-infinite-loop\docs\processes\rt-infinite-loop.md`
- Create: `C:\CTO Projects\rt-infinite-loop\templates\github-workflows\rt-loop.yml`
- Create: `C:\CTO Projects\rt-infinite-loop\templates\scripts\loop\run.sh`

**Step 1: Write the playbook**
- Define:
  - DoD gates (format/lint/test/smoke/security)
  - “No feature creep” enforcement checklist
  - `RUN_ID` convention and reporting contract (`docs/reports/latest-run.md`)
  - Network policy: network allowed, but all tool installs/downloads must be logged with versions captured in `latest-run.md`.

**Step 2: Add templates (not auto-applied)**
- Provide copy-paste templates for:
  - GitHub Actions workflow
  - Loop runner script
  - Apps SDK app scaffold (MCP server + optional UI bridge)

**Step 3: Verify**
- Run: `Test-Path "C:\\CTO Projects\\rt-infinite-loop\\skills_playbook.md"`
- Expected: `True`.

---

## Milestone 3: Adopt In A Project (Pilot = agency-os-mission-control)

### Task 5: Add Local Playbook + Loop Runner That Mirrors CI Gates

**Files:**
- Create: `AGENTS.md`
- Create: `skills_playbook.md`
- Create: `docs/reports/latest-run.md`
- Create: `scripts/loop/run.sh`
- Modify: `package.json` (add `test:smoke` if missing)
- Create: `tests/smoke/` (minimal smoke tests if missing)
- Modify: `.github/workflows/` (add `rt-loop.yml`)

**Step 1: Minimal local playbook**
- Link to:
  - `C:\CTO Projects\CodexSkills` (global skills)
  - `C:\CTO Projects\rt-infinite-loop` (reference process + templates)

**Step 2: Loop runner**
- Must:
  - Produce `RUN_ID`
  - Run format/lint/unit/smoke/security
  - Write `docs/reports/latest-run.md` on success and failure

**Step 3: CI gate**
- Add workflow that runs the same script and fails closed.

**Step 4: Verify**
- Run: `bash scripts/loop/run.sh`
- Expected: exits `0` only when all gates pass; otherwise non-zero with `latest-run.md` updated.

---

## Milestone 4: Apps SDK Starter (MCP + UI Bridge) Template

### Task 6: Provide An Apps SDK Scaffold Template (Repo-Agnostic)

**Files:**
- Create: `C:\CTO Projects\rt-infinite-loop\templates\apps\foundry-starter\server\README.md`
- Create: `C:\CTO Projects\rt-infinite-loop\templates\apps\foundry-starter\web\README.md`

**Step 1: MCP server skeleton**
- Include:
  - Tool metadata
  - Input validation
  - Idempotency for create operations
  - Structured logs with correlation IDs

**Step 2: UI bridge skeleton**
- Document the MCP Apps standard bridge assumption and local dev steps.

**Step 3: Verify**
- Provide a smoke checklist in `docs/apps-sdk/testing.md` that includes:
  - direct prompt
  - indirect prompt
  - negative prompt

