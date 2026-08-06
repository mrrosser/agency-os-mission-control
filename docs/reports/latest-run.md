# Latest Verification Run

## 2026-08-06 CRM UI, agents, and autonomy audit

- RUN_ID: 20260806-crm-ui-agents-full-audit
- Scope: responsive CRM, polling reliability, protected lead actions, runtime global pause, Agent API protocol, dual Google profiles, deploy safety, and authenticated browser coverage

[2026-08-06T17:24:00Z] gate=focused-final cmd=vitest result=PASS files=6 tests=24
[2026-08-06T17:26:00Z] gate=unit cmd=npm-run-test-unit result=PASS files=90 tests=340
[2026-08-06T17:27:00Z] gate=smoke cmd=npm-run-test-smoke result=PASS
[2026-08-06T17:30:00Z] gate=workflow-yaml-manifest-json result=PASS
[2026-08-06T17:30:00Z] gate=workflow-regression result=PASS files=2 tests=8
[2026-08-06T17:31:00Z] gate=lint cmd=npm-run-lint result=PASS
[2026-08-06T17:31:00Z] gate=typescript cmd=npx-tsc-noEmit result=PASS
[2026-08-06T17:33:00Z] gate=build cmd=npm-run-build result=PASS routes=96
[2026-08-06T17:34:00Z] gate=playwright-auth-list result=PASS projects=chromium,mobile-chrome tests=2
[2026-08-06T17:57:00Z] gate=playwright-authenticated-local result=PASS projects=chromium,mobile-chrome tests=2 temporary_account_cleanup=PASS
[2026-08-06T17:54:13Z] gate=github-pr-checks result=INFRASTRUCTURE_CANCELLED jobs_started=0 cause=github-actions-major-outage rerun_required=true
[2026-08-06T17:34:00Z] gate=dependency-audit result=PASS_WITH_EXCEPTION full=12 moderate=8 high=4 critical=0 production=13 moderate=9 high=4 critical=0 breaking_major_fixes_only=true
[2026-08-06T17:34:00Z] gate=gitleaks-staged result=PASS leaks=0
[2026-08-06T17:29:00Z] gate=rollback-snapshot result=PASS cloud_run_revision=ssrleadflowreview-00297-dnx hosting_channel=rollback-crm-audit-20260806 expires=2026-08-13T17:29:00Z
[2026-08-06T20:00:00Z] gate=scheduled-run-log-audit result=FAIL_OLD_REVISION http_status=200 hidden_failure=oauth.no_tokens,revenue.day2.response_loop_failed fix_required=true
[2026-08-06T20:00:00Z] gate=openclaw-runtime-remediation result=PASS heartbeat=disabled cpu_settled_pct=0-1 tailscale_gmail_health=200 model_capacity=BLOCKED_NO_CREDITS
[2026-08-06T19:59:00Z] gate=followup-profile-response-health cmd=npx-vitest-run result=PASS files=4 tests=21
[2026-08-06T20:13:00Z] gate=unit-concurrent cmd=npm-run-test-unit result=FAIL_RESOURCE_TIMEOUT passed=347 failed=1 file=api-secrets-fallback
[2026-08-06T20:14:00Z] gate=unit-timeout-isolation cmd=npx-vitest-run-api-secrets-fallback result=PASS tests=3
[2026-08-06T20:17:00Z] gate=unit-serial cmd=npx-vitest-run-tests-unit-maxWorkers-1 result=PASS files=92 tests=348
[2026-08-06T20:17:00Z] gate=lint cmd=npm-run-lint result=PASS
[2026-08-06T20:17:00Z] gate=typescript cmd=npx-tsc-noEmit result=PASS
[2026-08-06T20:19:00Z] gate=smoke cmd=npm-run-test-smoke result=PASS
[2026-08-06T20:22:00Z] gate=build cmd=npm-run-build result=PASS routes=96
[2026-08-06T20:24:00Z] gate=gitleaks-staged cmd=gitleaks-git-staged-redact result=PASS leaks=0
[2026-08-06T20:38:00Z] gate=revenue-cadence-retry-live-audit result=FAIL_EXPECTED_PREDEPLOY jobs=4 retry_mismatches=4 current_retry_count=0 target_retry_count=3 target_max_retry_duration=unset
[2026-08-06T20:40:00Z] gate=response-boundary-profile-retry-actions cmd=npx-vitest-run result=PASS files=5 tests=34
[2026-08-06T20:41:00Z] gate=touched-eslint cmd=npx-eslint result=PASS
[2026-08-06T20:41:00Z] gate=typescript cmd=npx-tsc-noEmit-incremental-false result=PASS
[2026-08-06T20:45:00Z] gate=unit-serial-final cmd=npx-vitest-run-tests-unit-maxWorkers-1 result=PASS files=93 tests=361
[2026-08-06T20:46:00Z] gate=smoke-final cmd=npm-run-test-smoke result=PASS
[2026-08-06T20:46:00Z] gate=lint-final cmd=npm-run-lint result=PASS
[2026-08-06T20:48:00Z] gate=build-final cmd=npm-run-build result=PASS routes=96
[2026-08-06T20:49:00Z] gate=gitleaks-staged-final cmd=gitleaks-git-staged-redact result=PASS leaks=0
[2026-08-06T20:59:00Z] gate=late-review-regressions cmd=npx-vitest-run result=PASS files=7 tests=43
[2026-08-06T21:00:00Z] gate=late-review-lint-typescript-powershell result=PASS
[2026-08-06T21:05:00Z] gate=unit-serial-late-review cmd=npx-vitest-run-tests-unit-maxWorkers-1 result=PASS files=94 tests=365
[2026-08-06T21:07:00Z] gate=smoke-lint-typescript-late-review result=PASS
[2026-08-06T21:10:00Z] gate=build-late-review cmd=npm-run-build result=PASS routes=96
[2026-08-06T21:10:00Z] gate=staged-integrity-late-review result=PASS diff_check=PASS powershell_scripts=2 gitleaks=PASS leaks=0

## 2026-08-06 agent API protocol hardening

- RUN_ID: 20260806-agent-api-protocol-hardening
- Scope: Canonical agent registry, authenticated heartbeat envelope, MCP connector probes, real OpenAPI contract

[2026-08-06T16:21:00Z] gate=focused-protocol cmd=npx vitest run agent-registry agent-status mcp-connector-health result=PASS files=4 tests=24
[2026-08-06T16:23:00Z] gate=control-plane-regression cmd=npx vitest run agent-control-plane autonomous-business agents-control-plane-route agents-actions-route result=PASS files=4 tests=14
[2026-08-06T16:29:00Z] gate=unit cmd=npm run test:unit result=PASS_WITH_RERUN full=286/287 timeout=api-secrets-fallback isolated=3/3
[2026-08-06T16:30:00Z] gate=smoke cmd=npm run test:smoke result=PASS
[2026-08-06T16:35:00Z] gate=build cmd=npm run build result=PASS routes=95
[2026-08-06T16:35:00Z] gate=lint cmd=npm run lint result=PASS
[2026-08-06T16:35:00Z] gate=typescript cmd=npx tsc --noEmit result=PASS
[2026-08-06T16:35:00Z] gate=openapi-yaml cmd=node+js-yaml result=PASS
[2026-08-06T16:37:00Z] gate=dependency-audit cmd=npm audit --audit-level=high result=FAIL baseline=26 moderate=11 high=13 critical=2 dependency_changes=none

## Prior RT Loop Report

- RUN_ID: 20260226-social-onboarding-runtime-m5
- Scope: Social dispatch smoke + authenticated runtime preflight + M5 acceptance start

[2026-02-26T19:43:03Z] gate=unit-social-dispatch cmd=npm run test:unit -- tests/unit/social-dispatch.test.ts result=FAIL
[2026-02-26T19:44:26Z] gate=unit-social-dispatch cmd=npm run test:unit -- tests/unit/social-dispatch.test.ts result=PASS
[2026-02-26T19:44:56Z] gate=smoke cmd=npm run test:smoke result=PASS
[2026-02-26T19:45:22Z] gate=lint cmd=npm run lint result=PASS
[2026-02-26T19:45:41Z] gate=social-flow cmd=npx vitest run tests/unit/social-drafts.test.ts tests/unit/social-dispatch.test.ts tests/unit/social-worker-auth.test.ts tests/smoke/social-drafts-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/social-draft-decision-route.test.ts tests/smoke/social-drafts-dispatch-worker-task-route.test.ts result=PASS
[2026-02-26T19:56:13Z] gate=social-dispatch-smoke cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=true scanned=0 attempted=0 failed=0
[2026-02-26T19:58:47Z] gate=social-dispatch-smoke-live cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=false scanned=0 attempted=0 failed=0
[2026-02-26T20:00:37Z] gate=runtime-preflight-auth cmd=GET /api/runtime/preflight result=FAIL status=fail missing_required=lead-source-budget-defaults,lead-run-queue warnings=followups-queue,competitor-monitor-queue,smauto-mcp-connector,smauto-mcp-auth,leadops-mcp-connector,social-draft-approval-base-url
[2026-02-26T20:01:07Z] gate=m5-internal-acceptance-start cmd=POST /api/social/drafts/rng-weekly/worker-task result=PASS draftId=7YtG8loIMcTehGWmAuaj weekKey=2026-W09 approvalNotified=true
[2026-02-26T20:21:54Z] gate=runtime-preflight-auth-remediated cmd=GET /api/runtime/preflight result=PASS_WITH_WARN status=warn missing_required=none warnings=lead-run-queue-oidc,leadops-mcp-connector
[2026-02-26T20:22:12Z] gate=social-dispatch-smoke-remediated cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=true scanned=0 attempted=0 failed=0
[2026-02-26T20:22:29Z] gate=social-dispatch-smoke-live-remediated cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=false scanned=0 attempted=0 failed=0
[2026-02-26T20:43:21Z] gate=runtime-preflight-auth-final cmd=GET /api/runtime/preflight result=PASS status=ok issues=none
[2026-02-26T20:43:39Z] gate=social-dispatch-smoke-final cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=true scanned=0 attempted=0 failed=0
[2026-02-26T20:43:57Z] gate=social-dispatch-smoke-live-final cmd=npm run social:dispatch:smoke result=PASS service=ssrleadflowreview dryRun=false scanned=0 attempted=0 failed=0
[2026-02-26T21:07:37Z] gate=smoke-control-plane cmd=npx vitest run tests/smoke/agents-control-plane-route.test.ts result=PASS
[2026-02-26T21:08:25Z] gate=unit-variant-decision cmd=npx vitest run tests/unit/revenue-variant-split-report.test.ts result=PASS
[2026-02-26T21:08:58Z] gate=lint cmd=npm run lint result=PASS
[2026-02-26T21:09:15Z] gate=unit cmd=npm run test:unit result=PASS
[2026-02-26T21:09:39Z] gate=smoke cmd=npm run test:smoke result=PASS
[2026-02-26T21:12:37Z] gate=build cmd=npm run build result=PASS
[2026-02-26T20:58:01Z] gate=social-e2e-live-proof cmd=node scripts/social-nonadmin-acceptance.mjs result=PASS uid=DM5ZZngePXXhNgN85Afi7W4Knoz2 draftId=AENAHk5dOtcAUTswhNG1 decision=approve dispatch_attempted=1 dispatch_dispatched=1 dispatch_failed=0
[2026-02-26T20:59:48Z] gate=external-nonadmin-acceptance cmd=POST /api/social/drafts + decision + dispatch result=PASS uid=external-acceptance-1772139588584 draftId=7N7oICwtbo5VeCsaHxWt status_flow=pending_approval_to_approved dispatch_attempted=1 dispatch_dispatched=1
[2026-02-26T21:03:10Z] gate=external-nonadmin-acceptance-script-user-mode cmd=npm run social:acceptance:nonadmin result=PASS auth_mode=user uid=external-acceptance-20260226150304 draftId=y08GwZnELgCFhdOI82zs listed_status=approved dispatch_attempted=1 dispatch_dispatched=1 dispatch_failed=0
[2026-02-26T21:04:54Z] gate=external-nonadmin-acceptance-script-user-mode-npm cmd=npm run social:acceptance:nonadmin result=PASS auth_mode=user uid=external-acceptance-20260226150448-npm draftId=KWx3P6fowuLp8TqSWR4B listed_status=approved dispatch_attempted=1 dispatch_dispatched=1 dispatch_failed=0
[2026-02-26T21:40:03Z] gate=scheduler-dispatch-retry cmd=gcloud scheduler jobs resume social-dispatch-retry-failed result=PASS state=ENABLED
[2026-02-26T21:43:21Z] gate=runtime-preflight-auth-post-secret-rotation cmd=GET /api/runtime/preflight result=PASS status=ok issues=none

## 2026-08-06 CRM autonomy policy foundation

- Scope: fail-closed policy helper plus authenticated Firestore policy API; no provider, dashboard, deployment, or production-data changes.
- `npm run lint`: PASS
- `tsc --noEmit`: PASS
- focused unit tests: PASS (18)
- focused API smoke tests: PASS (5)
- `git diff --cached --check`: PASS
- `gitleaks git --staged --redact --no-banner .`: PASS (no leaks)
