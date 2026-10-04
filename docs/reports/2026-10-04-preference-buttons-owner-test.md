# Preference buttons and isolated owner test: local release candidate

The existing warm invitation now supports three Gallery / RT.Solutions / Both buttons with a plain-text fallback and first-name greetings. A button preselects a choice on the existing preference page; only explicit confirmation saves it. The accepted postal address and both websites remain in the footer. Relationship recognition is not newsletter opt-in. No exact-five campaign has been authorized or sent.

## Scope and immutable review

This isolated checkout starts at `415962534022b24e9ec4fd01a90fecbe50885be5`, tree `f1bfeb35593b9df2164808fa6682527ea42dd3ff`, identical to deployed protected main `888bd8d981d311dae35e0db42bc4ae9ea95fb500`. The final external patch/manifest records the complete staged delta and candidate tree. The original checkout remains untouched. Dependencies, workflows, IAM, OAuth scopes, credentials, DNS, Scheduler and Firestore client rules are unchanged.

Campaign version `2026-10-04.1`, renderer v2 and MIME v2 invalidate earlier review fingerprints. Recheck zero live pilots before release; never silently migrate or approve earlier campaign artifacts. Any release branch must reconcile the baseline ancestry while preserving the reviewed source delta and run the existing protected checks. PR previews are disabled in the existing workflow.

## One owner-only test

The user explicitly authorized exactly one test to the fixed personal Gmail recipient, from the existing dedicated Gallery sender, with `[TEST]` subject. The backend freezes that message for review, checks its artifact and implementation fingerprints, and transactionally claims a single provider attempt. Unknown delivery or receipt failure blocks retry. Existing bound-account identity and scope checks remain enforced. No new provider grant or sender is needed.

The existing CRM Outreach tab now has an approved-test-inbox input, Prepare private test, the exact frozen HTML/plain-text review, a review checkbox, Send one test, and Refresh test receipt. The owner enters the already approved address; a fixed server-only SHA-256 pin accepts only that canonical address. The plaintext personal address is absent from newly changed public source and synthetic test fixtures. This needs no new runtime setting. Later sends use the frozen reviewed address. It uses existing Firebase owner authentication and the real workspace owner role. No action runs automatically. Preview links are removed and the iframe is sandboxed with no referrer. Owner changes clear pending/recipient/review/confirmation/error state; stale responses, including A-to-B-to-A switches, are ignored.

Only `crm_warm_reconnect_qa_runs`, `crm_warm_reconnect_qa_tokens`, `crm_warm_reconnect_qa_choices`, and `crm_warm_reconnect_qa_requests` are written by this flow. Typed capability digests, nonce-bound explicit confirmation, idempotent replay and sticky QA opt-out remain separate from canonical contacts, newsletter permission, suppression, production pilots and campaign locks. Capabilities last seven days for adding choices; unsubscribe remains available after expiry. The test page and success messages clearly describe test-only state. No live QA record or capability has been created.

GET, HEAD, link inspection and page load never write consent. The choice is an untrusted client-side fragment hint, not authority. The generic link does not opt anyone in. Production preference behavior remains purpose-separated from the QA API and unsubscribe capability.

## Verification

- Final privacy-corrected backend/routes/recipient validation: 47 tests in three files passed (`crm-owner-qa-privacy-tests-20261004.log`). This covers canonical artifact hashing, identity binding, one-attempt claims, ambiguity, expiry, replay, readback, QA isolation and recipient pinning. Private verification independently confirms the real authorized address matches the production digest; public fixtures use a synthetic address.
- Final privacy-corrected production build, whole-checkout TypeScript and scoped backend/panel/browser lint passed (`crm-owner-qa-privacy-build-final-20261004.log`, `crm-owner-qa-privacy-typecheck-20261004.log`, `crm-owner-qa-privacy-lint-20261004.log`, `crm-owner-qa-privacy-panel-lint-20261004.log`). The first local build attempt hit sandbox process-spawn EPERM; its approved local rerun passed without source changes.
- Final privacy-corrected production Chromium: 12/12 passed in 18.4 seconds (`crm-owner-qa-privacy-browser-20261004.log`): approved-inbox entry, explicit review/send/readback, network/unknown-delivery lockout, owner-switch races, inactive preview links, all three choices, no load-time consent, expiry, sticky opt-out, QA nonce routing and QA unsubscribe copy. All API/provider traffic was mocked or blocked; this was not a real send.
- Historical supporting evidence, before the final panel/privacy changes: 1,685 tests in 251 files (`crm-owner-qa-all-tests-20261004.log`), 33 focused QA cases (`crm-owner-qa-backend-tests-readback-20261004.log`), and the earlier 12-case panel browser run (`crm-owner-qa-panel-browser-20261004.log`). These are not claimed as final privacy-source runs. Earlier full lint passed with zero errors and two existing callback warnings.
- Final privacy scan found no personal target identifier in all 35 changed files and no personal address in all 196 built public JavaScript chunks (`crm-owner-qa-final-public-source-privacy-20261004.json`).
- Unchanged dependency audit: zero high/critical, 16 existing moderate findings (`crm-preference-buttons-audit-20261004.log`). No dependency update or audit exception.
- Independent source review found and resolved owner-switch pending-state and preview keyboard-link issues. No blocking source finding remains. Final staged whitespace and Gitleaks results are recorded in the immutable external manifest.
- Actual renderer generated five individual reviews and the separate owner review with inert placeholders; deterministic Marcus Voice scan passed. Original review artifacts are preserved outside the checkout.

## Live evidence and execution limits

Read-only metadata at 19:29–19:30 UTC October 4 found both dedicated sender bindings nonpending/nonrevoked, zero own-workspace pilots/ledgers/delivery receipts/executors/campaign locks, provider-send enabled and legacy worker authentication disabled. This did not read secrets or revalidate provider credentials. All 34 Scheduler regions contained 25 jobs, none directly warm-named or worker-targeted; indirect triggers were not ruled out. Both public websites returned HTTP 200 without redirect.

Authoritative SPF was present; DMARC was absent. The conventional `google` DKIM selector was absent, but the active selector is unknown. Campaign domain and automatic execution gates remain unresolved, and an owner test must not attest them.

Production publication is held for the coordinating parent's review of this new narrow release scope. The single owner send itself is already authorized. After release, use the existing signed-in owner at `/dashboard/crm`, Outreach. This tool session currently has no reachable authenticated owner browser, and its Google CLI principal lacks `iam.serviceAccounts.getOpenIdToken` for the existing worker identity. No IAM grant, token mint or authentication bypass was attempted. Deployment alone does not resolve this execution-access limit.

No production release, provider send, QA preparation, contact/consent mutation or persistent external configuration change occurred. The separate five-person campaign remains unapproved.
