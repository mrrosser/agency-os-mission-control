# Follow-on outreach batches and results

## Outcome and authority

Marcus confirmed the residency submission and five-person outreach completion and requested backend outcome tracking and an operating batch system using the already approved message. Preserve that message and sender. This authorizes implementation and preparation of subsequent batches; exact new recipients must have explicit existing CRM clearance or a reviewed recipient decision. Never infer relationship attestations from an address-book entry. Operating-mode preference is pending (review each new list, or auto-continue only explicitly cleared contacts); default to review each list.

## Verified baseline

- Main faba9d8d6ed6673140c2732514ca9640a8271743 / live ssrleadflowreview-release-37830871641-1.
- First five unique invitations completed with provider-Sent proof; original failed pre-provider pilot preserved.
- Current API/executor only supports initial_5. Initial campaign lock remains active after completion; advisory expanded range is not executable support. Do not reset that lock.
- Durable send receipts, invitation ledger, preference confirmations and unsubscribes exist. A campaign results view and automated reply/bounce attribution are missing.
- Existing approval expiry is 24 hours; it is not a post-send observation requirement. Do not add an arbitrary wait or grant new OAuth/IAM access.

## Implementation

1. Add a supported follow-on tranche of 1–10, anchored to a completed predecessor and an atomic follow-on execution lock. Preserve initial-five behavior/fingerprints and cross-pilot sent/unknown exclusions. Bind parent/sequence/size to exact approval.
2. Add a read-only results service/API and CRM summary: sent, stopped/unknown, confirmed topic choices, unsubscribes; clearly mark unsupported or unobserved metrics. Reuse an existing read connection only if verified for exact-thread reply/bounce reconciliation; no new grants or open-pixel claims.
3. Update CRM UI to show real execution/results status and prepare the next reviewed recipient list using the same approved design. Unknown relationships stay pending; identity conflicts stay excluded.
4. Add bounded automatic dispatch for an exact approved+launched batch, using existing worker identity and one recipient per invocation with minimum60-second cadence. No implicit audience approval, unrelated scheduler changes or automatic retry of uncertain sends.
5. Run focused regressions and full repository gates. Review/merge through protected CI and normal deployment. Verify live runtime and UI. Prepare a concrete next list and finish any genuinely new recipient decision with Marcus after all preparation is complete.

## Work ownership

- Batch core/types/repository/executor and regression tests: delegated after interface agreement.
- Results service/API and regression tests: delegated after integration assessment.
- UI, coordinator integration, final review and all external operations: root only.

## Verification and rollback

Required: lint, unit, smoke, build, high-severity audit, Gitleaks; mocks for provider APIs. Exercise initial-five compatibility, immutable completed predecessor, concurrent batch creation/claims, suppression changes, exact approval drift, cross-batch duplicates, completion at variable size and unknown-send no-retry. Reporting distinguishes zero observed events from unsupported collection. Use normal protected PR and Firebase merge workflow; rollback source through that workflow and preserve all receipts/ledgers. Document local run and deployment in a runbook.

## Progress

- [x] Baseline and product gaps verified.
- [x] Operating-mode preference has no reply; default is review each new list, followed by automatic paced dispatch after launch. Approved email is reused.
- [x] Core batches, reporting, UI and scoped OIDC dispatcher implemented. Independent review hardened predecessor provider-ID uniqueness, released-holder evidence, receipt document identity and truthful batch unsubscribe reporting.
- [x] Meaningful tests and required gates passed: protected CI 2,126/2,126 tests across 266 files, production build and audit; local TypeScript/lint and Gitleaks. Two local timing failures passed exact reruns without changed thresholds.
- [ ] Deployment and live readback verified.
- [ ] Concrete next recipients reviewed and authorized dispatch configured.

Focused checks passed: 157 batch contract/transaction cases, 158 activation/executor cases, 64 dispatcher cases, 45 follow-on route cases, 23 activation UI cases and 24 results/reader/API cases. TypeScript and full lint passed (two existing warnings). Dependency audit passes the unchanged high threshold (18 moderate, zero high/critical). Staged-patch Gitleaks found no leaks. Operational evidence is kept outside the source repository; no recipient contact details or capability URLs are included in this plan.

## Release checkpoint

PR62 merged normally as `25e28c21b6c90ed7bab325392a16205ab77c8786` after all protected checks passed. Main deployment run `37840238479` passed tests/build but failed before live promotion: Google Artifact Registry and Cloud Functions returned `BILLING_DISABLED`. The console confirms past-due or invalid payment information on the linked billing account; the current project login has limited billing access. A billing administrator must restore active billing. No billing configuration, payment, IAM grant, scheduler or additional send was performed. Live traffic remains 100% on the prior verified revision `ssrleadflowreview-release-37830871641-1`.

Marcus explicitly recognized and approved the exact next four recipients in this thread after seeing their names, addresses, sender and subject. That authorization is saved privately and persists; do not request it again. Next steps after billing recovery: verify service availability, release the validated 20-person follow-up below through the protected workflow, verify its exact revision and Hosting binding, prove dispatcher idle with the existing OIDC identity, install the single scoped cadence, prepare/record the approved four-person review in CRM, launch, and verify four unique sends. The original five remain complete and excluded. Do not bypass the release or send directly outside the CRM.

## Follow-up: 20-person batch capacity

Marcus requested a maximum of 20 recipients per batch while billing recovery is pending. Increase only the follow-on capacity; retain the original exact-five behavior, existing approved audiences, template, sender, approval expiry, one-recipient worker limit and minimum cadence. The four-person approval does not expand itself to 20 people. New names still need an exact audience decision.

The API, CRM selection, dispatcher, receipt projection and recovery query share the 20-recipient maximum. Reply metadata reads use at most ten parallel exact-thread reads, so a full batch remains two bounded waves within the existing browser deadline. Independent event/history caps are unchanged. The legacy advisory expanded-pilot range remains unchanged for compatibility; the executable follow-on range is 1–20.

- [x] Capacity changes and operating guide prepared on a branch from merged PR62.
- [x] Boundary, legacy compatibility and reporting tests passed: 386 tests across nine focused suites, including acceptance of 20/rejection of 21, exact completion, approved-four drift rejection, receipt query coverage and bounded reply reads. Independent final diff review found no blocking issue and confirmed unchanged fingerprint algorithms and message content.
- [ ] Protected PR validation complete; release held until billing is restored.

Once this follow-up is validated, merge it through the protected release path after billing recovery instead of retrying the superseded 10-person source. At the planned two-minute cadence, 20 recipients take roughly 40 minutes; the capacity increase reduces repeated audience review and does not create simultaneous bulk sends. The existing unordered 20-pilot history listing is a separate scalability limit and should be addressed before that history bound is reached.
