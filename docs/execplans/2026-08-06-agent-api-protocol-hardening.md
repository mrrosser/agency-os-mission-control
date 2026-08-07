# Agent/API Protocol Hardening ExecPlan

## Objective

Make Mission Control agent identity, heartbeat routing, capability declarations, and connector health fail closed while preserving human approval gates for consequential external writes.

## Scope

- Replace duplicate agent definitions with one canonical registry and five bounded revenue specialists.
- Validate authenticated heartbeat envelopes against caller org context, business unit, registered space, agent scope, trust level, capabilities, timestamp, and policy version.
- Keep consequential external-write capabilities exclusive to the existing `fn-actions` executor.
- Probe configured MCP endpoints with a timeout-bounded `initialize` and `tools/list` exchange before reporting them operational.
- Document the touched APIs and local/deployment verification.

## Safety and compatibility

- No credentials or endpoint tokens are persisted or logged.
- Unknown agents, spaces, business units, scopes, and capabilities are rejected.
- Heartbeat writes are idempotent and stored under the authenticated user.
- Existing UI reads remain compatible with the `spaces` response shape; additional envelope fields are additive.
- Optional connectors remain degraded when unconfigured or when a probe cannot prove capability availability.

## Verification

- [x] Registry and envelope unit tests
- [x] MCP probe unit tests with mocked fetch
- [x] Agent status route smoke tests
- [x] Control-plane smoke tests with mocked MCP and Paperclip APIs
- [x] `npm run lint`
- [x] `npm run test:unit` (286/287 passed in the full run; the pre-existing Secret Manager fallback test hit the shared 5s budget and passed 3/3 immediately when rerun alone with a 15s budget)
- [x] `npm run test:smoke`
- [x] `npm run build`
- [x] `npm audit --audit-level=high` (fails on the existing dependency baseline: 26 findings; this scoped patch changes no dependencies)

## Progress

- [x] Inventory current agent/status/control-plane paths.
- [x] Implement registry and envelope authorization.
- [x] Implement connector probes and honest health mapping.
- [x] Update OpenAPI and runtime docs.
- [x] Run verification and record remaining gaps.

## Remaining rollout work

- External OpenClaw/Google Chat heartbeat producers must switch from the legacy four-field payload to the v1 trust envelope before this patch is deployed. The route intentionally does not infer missing org, business, trust, or capability fields.
- The repository still authenticates heartbeat producers with Firebase ID tokens. A separate service-identity/OIDC profile would be required for headless runtimes that cannot obtain an approved Firebase token.
- Agent capability policy prevents non-executors from declaring consequential capabilities, while provider routes retain their existing human approval/worker-token gates. End-to-end agent attestation at every provider route is a broader follow-up.
- The existing dependency audit reports 11 moderate, 13 high, and 2 critical findings. Compatible framework/test-runner upgrades are being handled by the parent audit rather than mixed into this protocol commit.
