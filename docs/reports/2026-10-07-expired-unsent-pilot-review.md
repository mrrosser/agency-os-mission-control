# Expired, never-dispatched pilot recovery

An initial exact-five pilot can remain `launch_requested` after its approval expires even though dispatch never began. The old application closes approval in that state. The new owner action checks execution evidence and returns that same pilot to unapproved review. It preserves the original campaign lock, copy, audience, fingerprints and evidence. Approval and launch remain separate ordinary actions.

## Scope and authority

The strict, authenticated `return-to-review` endpoint uses the existing owner/workspace, current audience, fingerprint, idempotency and Firestore transaction path. Any executor document, any receipt (including an unexpected ID) or any deterministic invitation ledger entry rejects recovery. The same active campaign lock is mandatory. No execution evidence is deleted, and no provider function is called.

The transaction archives the previous approval and launch time in an immutable event before clearing current authority and rebuilding pending review gates. Its read/write boundary contends with the dispatcher claim, so both cannot succeed under the prior launch. The UI requires a reason, describes the no-send effect, resets approval confirmations and reloads after success.

This is a draft-PR candidate on `codex/crm-expired-pilot-review-20261007`, based on production merge `5eedcb94df79cedf4f70be1c9d185bdb0e3c4c8f`. No live recovery, approval, launch, provider send, deployment or merge was performed. Private recipient/campaign receipts and approved previews remain outside public source.

## Validation

| Check | Result |
| --- | --- |
| Full unit and smoke suites, two workers | **1,804 / 1,804 passed**, 257 files, zero pending |
| New recovery repository/pure-state cases | 24 passed; no provider calls asserted after every test |
| New endpoint smoke cases | 12 passed; auth, owner denial, strict/bounded body, idempotency, conflict and no-store |
| Existing activation UI render suite | 17 passed; new reason/action case keeps launch disabled and approval unavailable before recovery |
| Full lint | Passed: zero errors, two unchanged Google callback warnings |
| Standalone TypeScript | Passed |
| Production build | Passed, 91 generated static pages; recovery route included |
| Dependency manifests | Byte-for-byte unchanged from base |
| Scoped Gitleaks / whitespace | Passed: no findings / `git diff --check` clean |
| Official-registry dependency audit | **Failed**, three critical, three high and seventeen moderate findings |

The repository tests execute the real recovery repository logic against a versioned Firestore fake. They cover pristine two-document writes, preserved lock/content/history, exact idempotent replay, altered-request conflicts, malformed/empty executor data, unknown receipt IDs, released/cross-pilot ledger records, invalid locks, owner denial, current suppression changes and approval/fingerprint guards. A concurrent dispatcher claim forces transaction retry and rejection. The real dispatcher claim function rejects after recovery even when given an old timestamp. This is mocked transaction evidence, not a live concurrency experiment.

The fresh registry audit supersedes older zero-high/critical results. Current critical entries are `proxy-addr`, `tinypool` and `vitest`; high entries are `firebase-frameworks`, `sharp` and `source-map-js`. These come from the unchanged dependency lock. No automatic major upgrade or broad dependency repair is included. The existing protected audit gate remains required, so this draft is not release-ready.

External local validation artifacts are stored under `RNG_Artist_Projects/output/CTO_Projects/CRM_NextBatch_20261007/recovery-validation/`: `unit-smoke.json`, `unit-smoke.log`, `lint.log`, `typecheck.log`, `build.log` and `audit.json`. They contain test/runtime evidence rather than provider delivery receipts.

## Run, release and rollback

See [the recovery guide](../warm-reconnect-expired-launch-review.md) for local commands, the exact request contract and owner action after release. The existing protected PR/main Firebase workflow remains the only release path. PR validation does not deploy a preview and has provider sends disabled. Resolve the dependency gate separately before considering deployment.

Rollback is a reviewed source revert through the same workflow. Preserve recovery events and any already returned unapproved pilot; never reinstate an expired approval or delete the active campaign lock. This change needs no schema migration, new index, Firestore rule, credential, IAM or scheduler alteration.
