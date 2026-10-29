# Finite CRM review windows

## Objective and scope

Remove the artificial follow-on recipient-count ceiling. Each stored audience remains an exact finite queue, bounded by request/storage bytes and the complete available candidate evidence. Existing business-card contacts are the finite campaign audience; this does not authorize recurring acquisition or newsletter enrollment. Keep the campaign version, renderer, initial-five contract, exact approvals, invitation ledger, suppressions, failure holds, one claim per invocation, cadence, and provider controls unchanged.

The combined local release candidate also updates only Vite 7.3.6 to 7.3.7 and the existing transitive follow-redirects 1.16.0 to 1.16.1, using official npm registry artifacts. No other dependency version, override, or direct runtime dependency changes.

## Definition of done

- Shared UI/API/domain/reporting paths accept 101 and 346 synthetic recipients when byte budgets permit; reject nonpositive, unsafe, duplicate or mismatched counts before queries or writes.
- Existing approved audiences cannot expand and the original 20-person evidence remains valid.
- Creation rejects frozen audiences above 512 KiB before persistence, while the existing 32 KiB request bound stays intact.
- Reply refresh stays within its time budget at unchanged provider concurrency and reports incomplete reads as unknown.
- Unit, smoke, lint, build, security audit and patch secret scan run; record failures and limitations in the run report.
- Verify installed dependency versions and run the complete mocked unit/smoke suites with external connections blocked. Preserve the original cap checkout and export source, tests and manifests separately from private evidence.
- Independent review checks the resulting diff and tests. Release uses the repository PR/check workflow.

## Operational boundary

No new campaign, approval, launch, scheduler, consent, suppression or provider write is part of this code change. Before a finite rollout, reconcile current exclusions and Sent, assess provider/account capacity using the evidence described in the batch runbook, freeze the exact audience/content and obtain the application's fresh action-time approval. The Gmail REST API does not document a remaining daily send counter; absence of that counter is not itself a denial, and successful reads are not capacity proof. Use the owner's exact approved finite audience, at least 60 seconds apart, or slower/lower as current provider limits require. Stop on denial, unresolved provider restriction, unknown outcome or exhaustion; never automatically select a new audience.

## Follow-up scope on October 28

The later all-eligible instruction supersedes the count of 100. Keep the frozen array as the finite queue and use its validated exact length for receipt queries. There is no new persistent queue service, automatic admission of new contacts, expanded provider quota, or automatic approval of later windows. Existing 32 KiB requests and 512 KiB frozen records may require separate review windows. Preserve the earlier reviewed 16-file release candidate; prepare this successor in a separate local directory.
