# Return an expired, never-dispatched launch to review

An approved pilot can remain `launch_requested` until its approval expires without the dispatcher ever claiming a recipient. Approval rejects that state, so the owner previously had no supported path back to review. This change adds that path for the existing exact-five initial pilot. It does not renew approval, launch a campaign or call a provider.

## Guarded transition

The owner-only `POST /api/crm/warm-reconnect/pilots/[pilotId]/return-to-review` requires a nonempty `x-idempotency-key` and strict JSON containing `expiredApprovalId`, `expectedArtifactFingerprint`, `expectedAudienceFingerprint`, `expectedActionFingerprint` and `reason` (1–500 characters). It accepts no query parameters or extra authority fields. Responses are private/no-store.

The application rechecks the current workspace owner, sender readiness and recipient evidence through the existing repository path. The transaction requires the same active campaign lock, `launch_requested`, an exact-five initial audience, the matching finite expired approval and unchanged approval/content fingerprints. The transaction also checks for any executor document, any delivery receipt (including an unexpected ID), and every deterministic invitation-ledger entry. Any execution evidence, including apparently empty or previously released records, rejects recovery.

On success only the pilot and immutable operation event are written. The pilot becomes `needs_campaign_approval`; current approval and launch authority are cleared. The audit event preserves the previous approval, previous launch time, exact recovery request and correlation ID. Recipients, content, fingerprints, relationship decisions, suppressions and active campaign lock remain unchanged. No execution document is deleted or rewritten.

Recovery and the dispatcher read the same pilot. Recovery also reads the execution documents the dispatcher claims, and writes the pilot. Firestore transaction contention forces a retry and full guard recheck. A dispatcher claim that commits first prevents recovery; a recovery that commits first prevents a later claim under the old launch. The mocked versioned repository tests exercise both orders. Existing uncertain-outcome and no-retry rules remain unchanged.

## Owner workflow after a separately reviewed deployment

1. Open CRM Outreach and select the existing pilot. Confirm the exact saved audience and approved content. Do not create a replacement initial pilot.
2. If the saved approval expired, enter a reason and select **Check and return to review**. This button is provisional; the server checks execution evidence. A conflict requires reconciliation of the reported evidence, not a lock deletion or alternate send route.
3. Read back the same pilot in `needs_campaign_approval`, with no current approval or launch time and the same active campaign lock. The operation event must preserve the old approval and launch time. Repeating the exact request/key returns its receipt without another write; a changed request with that key fails.
4. Review current sender identity, exact audience, suppressions, relationship evidence and rendered artifact through the ordinary workflow. Obtain fresh exact-send authorization and truthfully complete the normal approval confirmations. Approval and launch remain separate actions. Recovery itself supplies neither authority.
5. Only after that approval, use the existing launch and scheduler-controlled dispatcher. Do not run an alternate provider call or an uncertain-delivery retry.

The UI resets local approval confirmations after recovery and reloads current state. It never chains approval or launch onto the recovery action. Existing provider flags, scheduler identity, cadence and maximum audience remain unchanged.

## Local run and validation

Use Node 22 and the existing locked dependencies: `npm ci`, then `npm run dev`. Do not add real credentials to tests. Run the focused regression suites with:

```sh
npx vitest run tests/unit/warm-reconnect-review-recovery.test.ts tests/smoke/warm-reconnect-review-recovery-route.test.ts tests/unit/warm-reconnect-ui.test.tsx
```

Repository gates remain `npm run lint`, `npm run test:unit`, `npm run test:smoke`, `npx tsc --noEmit`, `npm run build`, `npm audit --audit-level=high`, and a scoped Gitleaks scan. The UI render test verifies the recovery reason/button, disabled action before a reason, and disabled launch while the pilot is expired. Provider calls are mocked and asserted absent for every repository recovery test.

## Deployment and rollback

This candidate is a draft PR only. No live pilot operation, provider send, merge or deployment is part of preparing it. Use the existing protected PR/main Firebase workflow after review and all release gates pass. No Firestore rule, migration, index, dependency, credential, IAM, environment flag or scheduler change is required. The PR validation workflow has provider sends disabled and does not deploy previews.

The fresh October 7 registry audit fails on the unchanged dependency lock (three critical, three high and seventeen moderate findings). The release gate stays in force; resolve dependencies separately through review before deployment. Do not waive the gate for this feature.

Rollback the source through a reviewed revert and the same release workflow. Preserve all recovery events and live state: a pilot already returned to review safely remains unapproved under the prior application. Do not restore the expired approval, rewrite execution evidence, release the campaign lock or recreate a pilot as a rollback mechanism.
