# Finite CRM audiences without a recipient-count ceiling - 2026-10-29

Status: draft PR #66 is open against base 5cb1115af17ab0a92240d56b5bbb2aadc7884671. The first published commit, c43d5a68eabe930ff8d29aa74e897577741f4b65, passed CI tests and Promptfoo evaluations, but the fresh dependency audit blocked the build. This follow-up corrects those dependency blockers. Current-head CI and review remain required before merge; nothing has been merged, deployed or sent.

## Change and preserved behavior

Remove the artificial follow-on recipient-count maximum across UI, API, domain validation, dispatch and results. Initial-five behavior remains. The explicit Select all available for review action captures only the current candidate snapshot; it does not approve, launch or add later arrivals. Selection must remain distinct and present in complete current evidence.

The frozen recipient array remains the finite work queue. Before deriving receipt-read limits, validate its positive safe integer count, exact array length and distinct recipient identities. Read at most the exact count plus one and reject extra or malformed receipts. Released-holder recovery validates the holder before reading its receipts. Existing fingerprints, renderer, campaign version, exact approvals, 24-hour approval expiry, invitation ledgers, suppressions, failure holds and concurrency controls remain unchanged. Workers still claim one recipient per invocation, with at least 60 seconds between provider attempts and no automatic retry of uncertain outcomes.

The 32 KiB request and 512 KiB initial frozen-record budgets remain. Large or copy-heavy audiences may need separate review windows through the existing predecessor/approval workflow. Registry and reporting bounds still fail closed or report unknown. Removing a marketing count ceiling does not grant unlimited storage, source scans, provider quota or recurring contact acquisition.

The prior Vite 7.3.7 and follow-redirects 1.16.1 fixes remain. The fresh audit also found baseline Next.js 15.5.25, body-parser 1.20.6 and Zod 4.3.6 advisories. Upgrade to Next.js 15.5.28 and its matching lint packages, transitive body-parser 1.20.9 and Zod 4.6.6. Preserve the existing tinyglobby alias by retargeting its version-specific Next lint override and exact test assertions. The lockfile includes body-parser's required qs 6.16.2 and compatible picomatch 4.0.7 deduplication. No major dependency upgrade or security-policy change is included.

## Local validation

- Full unit/smoke rerun passed all 271 files and 2,502 tests in one invocation with four workers and unchanged timeouts/assertions. The preceding unconstrained local run had a stale exact lint-version assertion and one timeout under parallel load; the two version literals were updated to the inspected 15.5.28 consumer, and all dependency-boundary assertions remain equally strict.
- Full ESLint passed with zero errors and the two existing Google callback unused-variable warnings. Full tsc --noEmit passed.
- Production Next.js 15.5.28 build passed, including its type check and all 92 pages, with provider sends and telemetry disabled and only public Google Fonts/loopback connections permitted.
- Test network guards permitted only owned in-process loopback fixtures and recorded no external connections. Provider sends and telemetry were disabled.
- Independent review confirmed the narrow dependency changes, official npm artifacts, preserved security overrides and unchanged lint-rule/security assertions.
- The initial 26-file public upload matched every reviewed blob and passed a fresh Gitleaks scan. The follow-up adds the existing dependency-boundary test to the 27-file reviewed set. A fresh full-export Gitleaks scan gates each upload.

The October 29 PR audit completed and reported 17 affected packages: 14 moderate, two high and one critical. High/critical blockers were Next.js (including GHSA-2464-fhr4-w9xw), body-parser (GHSA-27r3-jxmh-p828) and Zod (GHSA-mrhx-c7xc-m3w5). The unchanged CI audit threshold must pass for this corrected head before release. No local audit retry or security-check suppression was used.

## Release and execution boundary

Use the protected PR and normal main-branch Firebase workflow after permitted repository access, current checks and review. Merge to main triggers deployment and requires its own authorization; no manual deployment around a blocked publication route is part of this work.

Before launch, reconcile current Sent, responses, suppression and failures, establish the applicable account edition and documented provider limits with recent usage/status evidence, and complete exact-message application approval. Gmail REST does not document a remaining daily-send counter. Absence of that counter alone is not a denial, and a successful Gmail read does not prove capacity. Follow the batch runbook's capacity assessment, pacing, retry-time and uncertain-outcome rules. No contact data, private reports, credentials, scheduler changes or provider settings are included in this candidate.
