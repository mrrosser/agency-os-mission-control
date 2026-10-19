# Owner recovery QA verification

The owner approved one fresh test email, but both prior fixed QA versions have been consumed and their capabilities expired. The recovery version adds a distinct fixed run so the existing one-attempt workflow can issue fresh seven-day QA links while preserving all historical runs.

Expected behavior: only the pinned owner can receive this test. Gallery, RT.Solutions and Both choices retain the existing approved body/design. Explicit confirmation and unsubscribe affect only QA state. Existing contact campaigns, newsletters and real preferences remain unchanged.

Local verification:

- Full unit/smoke: **2,280 tests in 268 files passed**, zero failed or pending. Credentials were excluded and provider sending disabled. The only eight network connections were to in-process loopback fixtures; no external API was reachable.
- Focused QA: **68/68 passed**, zero network attempts. Regressions cover distinct recovery preparation, historical records/body/assets/fingerprints, fixed recipient/version/strict routes, concurrency/replay/ambiguous send outcomes, exactly two run-bound seven-day capability digests, all three confirmation choices, expiry and sticky isolated unsubscribe.
- TypeScript passed. Lint passed with zero errors and two unchanged warnings in the Google callback route.
- Official npm audit passed the unchanged high threshold: zero high/critical and 18 moderate findings. Package files are unchanged from the deployed baseline.
- Independent source review passed 25/25 identity/scope checks; reviewed hashes cover all seven application/test files. Generic QA delivery/consent core, renderer and MIME implementation, artwork and historical test IDs are unchanged.
- Production build passed. Its 52 network connections retrieved only the allowed public Google Font assets; provider access and credentials remained disabled.
- The reviewed package manifest records the exact source hashes, complete-patch secret scan and apply check on the deployed base. Publication requires that manifest and all passing gate receipts.

Operational evidence is separate from these synthetic checks. Before the release, three Gallery mailbox searches found no prior recovery test, and an exact masked Firestore read found its deterministic run absent. The owner has explicitly authorized one send. Root will verify the deployed revision, refresh that precheck, prepare/review/freeze the exact artifact and submit it once. The live QA choices will be left untouched so the owner can test each selection and unsubscribe last. No real contact or newsletter mutation is part of the operation.

Evidence is retained in the workspace under `CRM_OWNER_RECOVERY_QA_*_2026-10-19` and the reviewed release manifest. The operational helper has a permanent local lock in addition to the application transaction; a timeout or ambiguous receipt requires reconciliation, never a blind retry. No IAM, credential, scheduler or deployment-setting changes are needed.
