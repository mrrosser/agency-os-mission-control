# ExecPlan: Authenticated OpenClaw Runtime Heartbeat

Date: 2026-08-07

Owner: Codex / RT Solutions

Status: complete

## Goal

Replace the impossible Cloud Run filesystem-manifest check with a non-model, Google-OIDC-authenticated VM receipt in Firestore and surface server-authoritative age and health in Agent Nexus.

## Safety contract

- No static bearer token, API key, or model call.
- Verify OIDC audience, Google issuer, verified email, and the exact publisher service account.
- Use Firestore `receivedAt` as the only freshness clock; never trust caller time for health.
- Make duplicate receipt replay idempotent without refreshing `receivedAt`.
- Reject old/out-of-order envelopes and fail closed when authentication, storage, or parsing fails.
- Keep receipt internals server-only under the existing default-deny Firestore rules.
- Do not change provider billing, model selection, or OpenClaw model heartbeat settings.

## Implementation

- [x] Add strict heartbeat envelope validation and Google OIDC authorization.
- [x] Add transactionally idempotent Firestore storage with a server timestamp.
- [x] Replace filesystem-manifest reads in the control-plane route.
- [x] Report operational, degraded, or offline from receipt age and critical service state.
- [x] Add focused unit and route smoke coverage.
- [x] Persist the three non-secret heartbeat settings across Firebase/Cloud Run release revisions.
- [x] Complete lint, typecheck, full unit/smoke, and production build.
- [x] Merge and deploy Agency OS with its OIDC environment allowlist.
- [x] Install the merged AI_HELL_MARY publisher and timer on the VM.
- [x] Verify an authenticated receipt and fresh control-plane status end to end.

## Validation

```powershell
npx vitest run tests/unit/openclaw-heartbeat.test.ts tests/smoke/openclaw-heartbeat-route.test.ts tests/unit/agent-control-plane.test.ts tests/smoke/agents-control-plane-route.test.ts
npx eslint lib/agents/openclaw-heartbeat.ts app/api/agents/openclaw-heartbeat/route.ts app/api/agents/control-plane/route.ts lib/agent-control-plane.ts tests/unit/openclaw-heartbeat.test.ts tests/smoke/openclaw-heartbeat-route.test.ts tests/unit/agent-control-plane.test.ts tests/smoke/agents-control-plane-route.test.ts
npx tsc --noEmit
npm run build
```

2026-08-07 evidence: focused heartbeat/control-plane tests passed (21/21), repository lint passed, TypeScript passed, the full unit and smoke suites passed, and the production build passed. `npm audit --audit-level=high` reports the repository's existing 12 transitive findings (8 moderate, 4 high); the available complete fixes require breaking framework/Admin SDK upgrades and are outside this scoped heartbeat rollout.

Live rollout evidence: Agency OS PR #31 merged as `6facad9388478692da3425a4e9917e5a1ec56c83`; deployment run `31204868508` completed successfully and promoted `ssrleadflowreview-release-31204868508-1` to 100% traffic. The active revision contains the exact audience, publisher-service-account allowlist, and runtime ID. An unauthenticated receipt was rejected with HTTP 401. The VM publisher merged as `487ae49e8f4bdddba7bc865bc1c1785a4fd928c5`; its first canary and next scheduled five-minute publish both returned HTTP 200. Firestore stored the exact source commit, all four active unit states, and a server `receivedAt`; an authenticated control-plane read reported `openclaw_sync` operational while a direct client receipt read failed closed with HTTP 403. Provider billing was unchanged and the model heartbeat remains disabled at `0m`.

## Rollback

1. Disable `openclaw-runtime-heartbeat.timer` on the VM.
2. Revert the Agency OS and AI_HELL_MARY merge commits through normal PRs.
3. Remove the three `OPENCLAW_HEARTBEAT_*` server environment variables if the endpoint is retired.
4. Leave model heartbeats disabled; this signal is independent of provider funding.
