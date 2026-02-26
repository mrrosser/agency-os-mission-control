# RT Loop Report

- RUN_ID: 20260226-social-dispatch-mcp-session
- Scope: Social dispatch transport hardening + verification gates

[2026-02-26T19:43:03Z] gate=unit-social-dispatch cmd=npm run test:unit -- tests/unit/social-dispatch.test.ts result=FAIL
[2026-02-26T19:44:26Z] gate=unit-social-dispatch cmd=npm run test:unit -- tests/unit/social-dispatch.test.ts result=PASS
[2026-02-26T19:44:56Z] gate=smoke cmd=npm run test:smoke result=PASS
[2026-02-26T19:45:22Z] gate=lint cmd=npm run lint result=PASS
[2026-02-26T19:45:41Z] gate=social-flow cmd=npx vitest run tests/unit/social-drafts.test.ts tests/unit/social-dispatch.test.ts tests/unit/social-worker-auth.test.ts tests/smoke/social-drafts-route.test.ts tests/smoke/social-drafts-worker-task-route.test.ts tests/smoke/social-draft-decision-route.test.ts tests/smoke/social-drafts-dispatch-worker-task-route.test.ts result=PASS
[2026-02-26T19:46:02Z] gate=social-dispatch-smoke cmd=npm run social:dispatch:smoke result=BLOCKED reason=missing SOCIAL_DISPATCH_SERVICE_URL/SOCIAL_DRAFT_WORKER_TOKEN/SOCIAL_DRAFT_UID in local env
