# ExecPlan: Private Paperclip Heartbeat Projection

Date: 2026-08-08

Owner: Codex / RT Solutions

Status: implementation_in_progress

## Goal

Surface the private Paperclip VM runtime in Agency OS through the existing authenticated OpenClaw OIDC receipt, without adding a public Paperclip endpoint or lifecycle-action authority.

## Safety contract

- The receiver fields are optional so the existing publisher remains accepted during rollout and rollback.
- The route remains strict for unknown fields and validates every reported state.
- The projection contains only health states; no URL, key, admin credential, board content, or customer data is accepted.
- Firestore retains one overwritten runtime document and server `receivedAt` remains the freshness authority.
- Visibility does not grant action proxying. `canProxyActions` and consequential capabilities remain false.
- Deploy this receiver before the VM publisher begins sending the optional states.

## Implementation

- [x] Accept optional `paperclip_api` and `paperclip_bridge` service states.
- [x] Require both to be active whenever either is present.
- [x] Build a visibility-only Paperclip snapshot from a fresh authenticated receipt.
- [x] Surface that snapshot in the Paperclip System service card without requiring a public endpoint.
- [x] Add unit and route smoke coverage for legacy and extended receipts.
- [ ] Pass focused tests, lint, type/build, and diff checks.
- [ ] Merge and deploy the receiver before the VM publisher.
- [ ] Verify legacy and extended live receipts and the Paperclip control-plane card.

## Validation

```bash
npx vitest run \
  tests/unit/openclaw-heartbeat.test.ts \
  tests/smoke/openclaw-heartbeat-route.test.ts \
  tests/unit/paperclip-client.test.ts \
  tests/unit/agent-control-plane.test.ts
npx eslint \
  lib/agents/openclaw-heartbeat.ts \
  lib/paperclip/client.ts \
  lib/agent-control-plane.ts \
  app/api/agents/control-plane/route.ts \
  tests/unit/openclaw-heartbeat.test.ts \
  tests/smoke/openclaw-heartbeat-route.test.ts \
  tests/unit/paperclip-client.test.ts \
  tests/unit/agent-control-plane.test.ts
npm run build
git diff --check
```

## Deployment

1. Merge to `main` and deploy the normal Agency OS Cloud Run revision.
2. Verify `/api/health` and a fresh legacy OpenClaw receipt.
3. Deploy the AI Hell Mary publisher/runtime recovery.
4. Verify Firestore stores both optional states and the authenticated control-plane view reports the Paperclip System through `visibility_only` projection.

## Rollback

First roll back the VM publisher so it stops sending optional fields. Then revert this receiver change through the normal PR/deployment path. Existing legacy heartbeat documents remain valid throughout.
