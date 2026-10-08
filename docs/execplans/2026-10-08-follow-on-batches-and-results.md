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
- [ ] Meaningful tests and required gates passed.
- [ ] Deployment and live readback verified.
- [ ] Concrete next recipients reviewed and authorized dispatch configured.

Focused checks passed: 157 batch contract/transaction cases, 158 activation/executor cases, 64 dispatcher cases, 45 follow-on route cases, 23 activation UI cases and 24 results/reader/API cases. TypeScript and full lint passed (two existing warnings). Dependency audit passes the unchanged high threshold (18 moderate, zero high/critical). Staged-patch Gitleaks found no leaks. Full unit/smoke/build release gates and live verification are pending at this checkpoint. Operational evidence is kept outside the source repository; no recipient contact details or capability URLs are included in this plan.
