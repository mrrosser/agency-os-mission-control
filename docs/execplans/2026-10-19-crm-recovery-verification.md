# CRM recovery verification

## Objective and scope

Restore reviewed CRM software readiness after the owner restored existing Google Cloud billing on 19 October. Preserve original message approvals, stored audiences, capabilities, initial campaign lock, five sent ledgers and delivery evidence. No batch send, contact subscription, old-message replay, scheduler change, credential creation, IAM change or billing change is part of verification.

Use the existing protected PR and Firebase release workflow. The October 10 local-only preparation remains historical evidence; this recovery candidate carries its exact reviewed changes forward under the owner's new software-repair instruction. Fresh owner test delivery requires an exact separately confirmed action. Existing expired test runs must not be reset or replayed.

## Candidate provenance

Base commit: `503e786a5c72bbc917596ce19590976d737c3719`, the open PR63 capacity-20 candidate. The original 17-file October 10 patch was independently recovered byte-for-byte, SHA256 `7657ecc2514b8b9de259697dd8dc85f9292d12d1c97e16ee72845fea8b2b64bf`. Its original checkout, manifest and receipts remain unchanged.

The existing runtime still serves `ssrleadflowreview-release-37830871641-1`, source `faba9d8d6ed6673140c2732514ca9640a8271743`. Fourteen anonymous Hosting/direct-runtime probes passed after billing restoration. Existing owner QA links return the correct expired state with updates disabled and unsubscribe available; inspection did not mutate consent.

## Verified repair

An isolated offline reproduction showed that a valid preference capability could inspect and save topic choices after the canonical contact was marked `opted_out` or `suppressed`, if the separate preference/suppression documents had not also changed. The send executor already blocks these canonical states, but the preference path could append conflicting topic-consent evidence.

Read canonical opt-out and delivery suppression in both inspection and the transactional save boundary. An explicit canonical opt-out is global. A delivery suppression blocks new choices without being relabeled as voluntary opt-out. Preserve stored topics and append-only history; keep unsubscribe available. Recheck current state before idempotent replay as well as new requests.

## Verification gates

- Regressions for canonical-only opt-out/suppression, normalized state, no consent writes while blocked, preserved classification/history, permitted unsuppressed states and replay after a new blocker.
- Existing offline confirmation, capability expiry/scope, QA isolation, unsubscribe, sender profile, suppression, duplicate, ledger, history and batch-boundary tests.
- Full unit/smoke, nonincremental TypeScript, lint, production build, current official-registry high-threshold dependency audit and complete-diff Gitleaks.
- Independent review of the new preference correction and recovered 17-file patch integrity.
- After any release, verify exact Hosting/runtime source binding, public preference routes and an owner-only QA flow appropriate to the approved scope. Do not infer successful live confirmation from GET or expired-token inspection.

## Remaining operational checks

Current replies, delivery-policy rejections, suppression and sent ledgers must be reconciled before selecting a new exact batch. A delivery-policy rejection is not an invalid address or voluntary opt-out and must not cause a resend of a previously attempted invitation. Existing relationship attestation is not newsletter consent. Sending remains outside this verification task.
