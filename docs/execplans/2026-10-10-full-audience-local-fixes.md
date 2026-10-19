# Full-audience CRM preparation fixes

## Outcome and authority

Marcus approved local preparation and testing of the batch/history retrieval fix and safe personalization fallback on 10 October 2026. The parent explicitly limited publication to local files: no push, new remote PR, merge, deployment, billing/IAM/credential changes, campaign lock changes or send execution. The existing contact population has current owner relationship attestation for one-time invitations, not newsletter opt-in.

Base: `503e786a5c72bbc917596ce19590976d737c3719` (PR63, not deployed). Work in the isolated local branch `codex/crm-full-audience-fixes-20261010`; preserve the prior checkout and its uncommitted documentation.

## Implementation scope

1. Retrieve authoritative campaign heads independently of bounded history so the normal review/approval/launch UI remains usable with nineteen new batches plus two existing pilots and beyond. Keep reads bounded, avoid new undeployed Firestore index dependencies where feasible, and preserve exact ownership and chain checks.
2. Freeze a safe neutral greeting for uncertain imported names when creating new pilots. Keep normal names and existing stored pilot content/fingerprints unchanged. Expose the frozen preview through existing review semantics; never guess identity or alter CRM people to repair a greeting.
3. Investigate existing supported local execution routes using source and read-only evidence. Assess approvals, recipient-bound preference/confirmation/unsubscribe pages, suppression/deduplication, cadence, capability receipts and durable execution records. Do not execute a provider route or build a substitute mailer.

## Invariants

- Original initial-five lock, completed pilot, sent receipts and invitation ledger are immutable to this task.
- No newsletter opt-in arises from owner attestation or invitation delivery.
- Exact reviewed audiences, fingerprints, approvals, one-recipient execution and cadence protections remain in force.
- No recipient PII, capability links, tokens or credentials in committable code/tests/docs.
- Provider sends remain disabled in local build/validation; provider calls in tests are mocked.

## Verification

Run meaningful regressions for history overflow/current-head visibility, ownership/isolation, stale or malformed lock evidence and greeting fallback/legacy compatibility. Independently review the integrated diff. Required repository checks: full unit and smoke suites, TypeScript, lint, production build, high-severity dependency audit and Gitleaks. Record exact outcomes and distinguish existing unrelated failures from new regressions without weakening thresholds.

## Progress

- [x] Read repository instructions, current execution plan and applicable workflow files.
- [x] Created isolated local worktree from the exact reviewed PR63 head.
- [x] Implemented and independently reviewed history retrieval.
- [x] Implemented and independently reviewed greeting fallback.
- [x] Completed supported local-route investigation.
- [x] Passed full unit/smoke, TypeScript, lint, production build and high-severity dependency checks; prepared the reviewed local diff for final manifest-backed packaging.

Final full suite: 2,256 tests across 268 files. Independent review found no blocking or unresolved findings. The external patch manifest records exact file hashes, the disposable-index apply check and complete-patch Gitleaks result. See the [verification report](../reports/2026-10-10-full-audience-local-fixes.md).

Publication and actual execution remain separate from this preparation. Return the exact next action and any missing authorization through the parent.
