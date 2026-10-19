# CRM recovery after billing restoration

## Result and scope

Existing Firebase Hosting and direct runtime routes recovered after the owner restored billing. Fourteen anonymous probes returned HTTP 200 on 19 October. The CRM application is at `https://leadflow-review.web.app/dashboard/crm`; the domain root remains the existing Firebase welcome page. The three existing owner test choices inspect correctly as expired, with preference confirmation disabled and unsubscribe still available. No consent, campaign, contact, ledger or provider-send mutation was performed during these checks.

This candidate carries forward the exact reviewed October 10 changes and fixes a newly reproduced canonical-contact preference gap. It is a local candidate, not a deployed release. Existing owner tests cannot demonstrate fresh confirmation because their capabilities expired on 12 October.

## Candidate and deployed provenance

- Candidate base: `503e786a5c72bbc917596ce19590976d737c3719`, open PR63's capacity-20 head.
- Original 17-file patch SHA256: `7657ecc2514b8b9de259697dd8dc85f9292d12d1c97e16ee72845fea8b2b64bf`. Its original checkout, bytes, manifest and receipts remain unchanged. The separate recovery checkout preserves original content, with patch-application line-ending normalization only.
- Restored serving revision: `ssrleadflowreview-release-37830871641-1`, source `faba9d8d6ed6673140c2732514ca9640a8271743`, GitHub run `37830871641`. Cloud Run traffic and Hosting binding identify the serving revision; updated function metadata alone does not establish deployment of a new candidate.
- No dependency, workflow, IAM, credential, scheduler, billing or sender-profile change is included.

## Preference correction

A valid production preference capability could previously permit topic confirmation when the canonical contact alone was marked `defaultPermissionState=opted_out` or `suppressed=true`, if the separate preference/suppression documents had not also changed. The send executor already blocked those states, but preference confirmation could append conflicting consent evidence. An isolated reproduction failed both cases before the correction.

Inspection and the existing transaction now consult the canonical contact. Normalized explicit opt-out is global; delivery suppression independently blocks new choices without being described as a voluntary opt-out. The transaction rechecks current state before either idempotent replay or new writes. Stored topics and append-only history remain intact, and unsubscribe remains available. Existing UI controls already obey update eligibility.

Eight regressions cover canonical-only blockers, normalization, allowed unsuppressed states, preserved policy classification/history, blocked replay and retained unsubscribe behavior. The focused CRM verification passed 768 tests across 33 files with zero network attempts. Independent review found no blocking or unresolved issue. The original October 10 campaign/history, pagination, full-ledger exclusion and frozen-greeting protections remain intact.

## Verification evidence

- Focused CRM: 768 tests / 33 files passed; isolated two-case reproduction changed from two failures to two passes.
- Full unit/smoke: **2,264 / 2,264 tests passed across 268 files**, zero failed or pending. The final complete run finished at 18:13:23 UTC. Its eight transport connections were exclusively to the in-process synthetic fixture on `127.0.0.1`.
- Nonincremental TypeScript: passed.
- Full lint: passed, zero errors and two unchanged callback warnings.
- Production build: passed. The first strictly offline sandbox attempt blocked existing Google Fonts requests and encountered a sandbox `.next` directory permission error. The successful isolated retry allowed only public Google Fonts assets and loopback; all 52 recorded connections were to the two Google font hosts. Production API access and credentials remained excluded.
- Fresh official-registry audit at the unchanged high threshold: exit 0, zero high/critical and 18 moderate findings. Package files were unchanged. The first sandbox DNS failure and successful authorized registry-read retry are preserved separately.
- Full candidate patch apply-check and Gitleaks are enforced by the packaging helper before it can emit a release manifest. The external manifest records these results against the exact patch bytes and all 21 candidate file hashes.

The first full suite passed 2,255 of 2,264 tests. Eight failures came from blocking the suite's synthetic loopback gRPC fixture; the remaining lint-boundary test exceeded its existing 20-second limit while other heavy checks ran concurrently. The 18 tests in those two files passed unchanged in an isolated rerun with original assertions and timeouts. The final passing complete suite used a guard allowing only `127.0.0.1` ports opened by a server in the same test process, with credentials excluded and provider sending disabled. The intermediate sandbox loopback retry also records OS-level `EACCES`; it is not an application defect. No assertion, timeout or repository test configuration was weakened.

External evidence artifacts retain command receipts, timestamps, source hashes, original failed attempts, independent review, network restrictions, complete patch and manifest. These artifacts intentionally exclude capability values and credentials.

## Operational limits and next action

The restored runtime still serves the older release. Publish the exact reviewed candidate through the existing protected PR/main workflow, then verify the resulting source/Hosting/runtime binding and recipient routes. Current branch-protection administration is unavailable to the connected read-only integration; historical required checks are evidence, not a claim of current administrative access. Do not bypass branch protection or alter release workflows.

The old owner tests are consumed and expired. A fresh end-to-end confirmation check requires a new fixed owner-only QA version, exact reviewed artifact and one separately confirmed send action; do not reset or replay an old QA run. Preserve the existing QA renderer, frozen fingerprints, owner recipient and Gallery sender. QA confirmation/unsubscribe must remain confined to QA storage. No fresh version, token or email was created in this verification.

A current Gmail profile read confirms the Gallery account identity only. It does not establish the application's dedicated stored credential or a newly delivered message's authentication. Fresh sender/receipt evidence remains part of that explicitly bounded QA action.

Before any new campaign batch, reconcile current responses, delivery-policy rejections, suppressions and sent ledgers. Preserve the completed five-send replacement, stopped zero-attempt original and campaign lock. A policy rejection is not an invalid address or voluntary opt-out; a previously attempted invitation must not be resent. Historical relationship attestation and business-card possession are not newsletter consent. Sending and new subscription changes remain outside this verification.

See [execution plan](../execplans/2026-10-19-crm-recovery-verification.md), [October 10 report](2026-10-10-full-audience-local-fixes.md) and [batch runbook](../runbook-warm-reconnect-batches.md).
