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
