# Finite CRM audiences without a recipient-count ceiling - 2026-10-28

Status: local successor candidate prepared for review against base 5cb1115af17ab0a92240d56b5bbb2aadc7884671. Not published, merged or deployed. The previous 16-file candidate remains unchanged. A fresh dependency advisory check is outstanding; do not describe this as release-approved.

## Change and preserved behavior

Remove the artificial follow-on recipient-count maximum across UI, API, domain validation, dispatch and results. Initial-five behavior remains. The explicit Select all available for review action captures only the current candidate snapshot; it does not approve, launch or add later arrivals. Selection must remain distinct and present in complete current evidence.

The frozen recipient array remains the finite work queue. Before deriving receipt-read limits, validate its positive safe integer count, exact array length and distinct recipient identities. Read at most the exact count plus one and reject extra or malformed receipts. Released-holder recovery validates the holder before reading its receipts. Existing fingerprints, renderer, campaign version, exact approvals, 24-hour approval expiry, invitation ledgers, suppressions, failure holds and concurrency controls remain unchanged. Workers still claim one recipient per invocation, with at least 60 seconds between provider attempts and no automatic retry of uncertain outcomes.

The 32 KiB request and 512 KiB initial frozen-record budgets remain. Large or copy-heavy audiences may need separate review windows through the existing predecessor/approval workflow. Registry and reporting bounds still fail closed or report unknown. Removing a marketing count ceiling does not grant unlimited storage, source scans, provider quota or recurring contact acquisition.

The prior narrow dependency fixes remain exactly Vite 7.3.7 and follow-redirects 1.16.1. Package manifests and lockfile are byte-identical to the earlier combined candidate; no further package change was made.

## Local validation

- Full unit/smoke run covered 271 files and 2,502 tests. Initially 2,492 passed; eight synthetic gRPC tests were blocked by sandbox loopback restrictions and two UI tests needed fixture/text-expectation corrections.
- Approved isolated gRPC rerun: all 8 passed, with connections restricted to in-process fixture ports on literal 127.0.0.1. Corrected full UI file rerun: all 43 passed. Thus all 2,502 tests have passing coverage across the main run and focused reruns; this is not a claim of one clean all-suite invocation.
- Independent backend runs: 611 tests passed across 12 files, covering 101/346 synthetic audiences, corrupt counts before queries, exact/extra/duplicate receipts, unchanged historical fingerprints, reporting overflow and one provider call per invocation.
- Full ESLint passed with zero errors and the two existing Google callback unused-variable warnings. Full tsc --noEmit passed.
- Production Next.js build passed, including its application type check. The first restricted attempt failed on font DNS and build-directory permissions. The approved rerun allowed only public Google Fonts and loopback traffic; its connection log contains only fonts.googleapis.com and fonts.gstatic.com. Sending and telemetry were disabled.
- Test network guards prevented external connections. Independent source review found no concrete defect or provider-control weakening.
- Code-only export reverse-apply validation and Gitleaks scan passed. Final exported code and documentation are scanned separately from private operational evidence.

A fresh npm audit did not complete: the initial restricted invocation could not resolve the registry, and the subsequent approval review denied metadata disclosure. No alternate audit route was used. The unchanged earlier candidate's October 21 installed audit reported zero high/critical and 16 moderate findings; that historical result is not a current advisory refresh.

## Release and execution boundary

Use the protected PR and normal main-branch Firebase workflow after permitted repository access, current checks and review. Merge to main triggers deployment and requires its own authorization; no manual deployment around a blocked publication route is part of this work.

Before launch, reconcile current Sent, responses, suppression and failures, establish the applicable account edition and documented provider limits with recent usage/status evidence, and complete exact-message application approval. Gmail REST does not document a remaining daily-send counter. Absence of that counter alone is not a denial, and a successful Gmail read does not prove capacity. Follow the batch runbook's capacity assessment, pacing, retry-time and uncertain-outcome rules. No contact data, private reports, credentials, scheduler changes or provider settings are included in this candidate.
