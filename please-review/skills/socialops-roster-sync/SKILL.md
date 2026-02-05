---
name: socialops-roster-sync
description: Sync client roster + brand profile sheets and Drive assets for SocialOps. Use when asked to refresh roster/brand data, scan client Drive changes, or reconcile approvals with Google Sheets.
---

# SocialOps Roster Sync

## Overview
Keep roster and brand profile data aligned with Google Sheets/Drive and the SocialOps orchestrator.

## Workflow
1) Identify `client_id` (org slug) and the roster/brand profile sheet IDs.
2) Run a sheet sync via the orchestrator (`run_type=sheet_audit`) with context:
   - `sheet_id`, `days_back`, `apply_changes=true`.
3) Run a Drive scan (`run_type=drive_scan`) with context:
   - `folders` (or `root_folder_id`), `scan_nested=true`, `days_back`, `apply_changes=true`.
4) Verify output:
   - Confirm updated drafts, approvals, and asset inventory in `output_data`.
   - Confirm Sheets logging includes `status`, `approval_status`, and timestamps.
5) Re-run with a narrower scope if conflicts appear (single sheet or folder).

## Notes
- Keep changes idempotent; prefer explicit `post_id` or `bundle_token` matches.
- Default approvals to `pending` unless explicitly auto-approved.
- Never store secrets in sheets; use Secret Manager or env vars.
