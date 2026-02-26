# RT Loop Report

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
