# Rosser Gallery collector-lead CRM ingest runbook

## What it does

`POST /api/integrations/rosser-gallery/collector-leads` accepts strict,
campaign-pinned browser lead contracts and transactionally writes:

- one projected CRM customer in `leads`;
- one inquiry event in `activities`;
- one purpose-scoped, append-only event in `crm_consent_events`;
- one durable HMAC contact identity in `crm_contact_identities`;
- one payload-and-route-bound receipt in `crm_ingest_receipts`;
- one per-credential daily create counter in `crm_ingest_rate_limits`.

The route has a 32 KiB body limit and a 500-new-events-per-UTC-day limit shared
across its authenticated credential. Exact
receipt replays do not consume quota. It does not send email or SMS, activate an
ad, publish a campaign, write Square or Etsy, or grant RT Solutions consent. An
unchecked Gallery marketing box never inherits or relabels consent from another
business unit.

`GET /api/integrations/rosser-gallery/collector-leads` is the authenticated,
non-writing readiness check used for candidate smoke tests.

## Supported lead contracts

| Schema | Campaign ID / namespace | Browser lead events |
| --- | --- | --- |
| v1 | `the-braider-atlanta` | legacy `collector_request` payload (no root `eventType`) |
| v2 | `white_linen_night_nola_2026` | `event_preview_lead`, `private_viewing_inquiry`, `commission_inquiry` |
| v2 | `etsy_store_launch_20260801` | `etsy_waitlist_submit`, `etsy_product_inquiry` |

Examples are in `contracts/rosser-gallery/collector-lead.v1.json`,
`contracts/rosser-gallery/white-linen-preview-lead.v2.json`, and
`contracts/rosser-gallery/etsy-launch-waitlist.v2.json`.

V2 pins the root lane, campaign ID and namespace, market, language, event/shop,
external-event prefix, consent version, event/interest pairing, and first/last
touch UTM namespace. A touch may omit all UTMs for direct traffic; a partial or
mismatched UTM tuple is rejected. Tags are never accepted from the sender. The
receiver derives and append-dedupes only the campaign and explicit-intent tags
documented by the CRM projection.

This endpoint is intentionally lead-only. Page views, directions/outbound
clicks, check-ins, purchases, orders, refunds, and provider commerce events are
not valid receiver payloads. Signed Square and future signed Etsy/server paths
own those events.

Contract support is not campaign activation. Each website sender must retain a
separate, fail-closed per-lane enable gate. This receiver cannot create, publish,
activate, resume, or spend on Meta, Etsy, Square, or any other provider.

## Required configuration

Copy `.env.example` to `.env.local` and provide:

- `CRM_INGEST_TOKEN`: independent random secret, 32+ characters;
- `ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET`: independent stable random secret, 32+ characters;
- `ROSSER_GALLERY_CRM_OWNER_UID=fMsduRLGAQfk7BMFOe3N9kkIe8y2`;
- `ROSSER_GALLERY_CRM_WORKSPACE_ID=ws_cd43331c4b1648d0`;
- `ROSSER_GALLERY_CRM_BUSINESS_UNIT=rosser_nft_gallery`.

The routing IDs were resolved read-only on 2026-07-26 from 31 existing Gallery
records and confirmed against workspace `ws_cd43331c4b1648d0`. Never give the
HMAC secret to the website sender. The bearer token belongs in both systems'
server-side secret stores, never browser JavaScript or a `NEXT_PUBLIC_*` value.

## Local verification: emulator only

Never run the write-bearing POST smoke against production or a local process
connected to production Firestore. In terminal 1:

```powershell
firebase emulators:start --only firestore --project demo-rosser-crm
```

In terminal 2, set synthetic local secrets and force the Admin SDK to the emulator:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:GOOGLE_CLOUD_PROJECT = 'demo-rosser-crm'
$env:FIREBASE_PROJECT_ID = 'demo-rosser-crm'
$env:CRM_INGEST_TOKEN = '<local-random-32-plus-character-token>'
$env:ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET = '<local-stable-32-plus-character-secret>'
$env:ROSSER_GALLERY_CRM_OWNER_UID = 'local-owner'
$env:ROSSER_GALLERY_CRM_WORKSPACE_ID = 'local-workspace'
$env:ROSSER_GALLERY_CRM_BUSINESS_UNIT = 'rosser_nft_gallery'
npm run dev
```

Then POST the synthetic fixture. Change the event UUID and timestamps only for a
new create; use the exact same logical payload and key for replay verification:

```powershell
$payload = Get-Content -LiteralPath 'contracts/rosser-gallery/collector-lead.v1.json' -Raw | ConvertFrom-Json
$body = $payload | ConvertTo-Json -Depth 20 -Compress
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3000/api/integrations/rosser-gallery/collector-leads' `
  -Headers @{
    Authorization = "Bearer $env:CRM_INGEST_TOKEN"
    'X-Idempotency-Key' = $payload.externalEventId
    'X-Correlation-Id' = 'rng-emulator-test-0001'
  } `
  -ContentType 'application/json' `
  -Body $body
```

First create returns `201`; exact replay returns `200`; changed payload with the
same key returns `409`. The emulator may be cleared after verification.

## Sender retry rules

- Retry network failures, `429`, and `5xx` with bounded exponential backoff.
- Retry the same logical payload with the same `externalEventId` and key.
- Treat `200` and `201` as success.
- Treat `400`, `403`, `409`, and `413` as terminal and retain for operator review.
- Never log contact fields or either credential.

V1 remains pinned to `rg_collector_<UUID>` and campaign identity
`the-braider-atlanta` / `atlanta` / `en-US` / `the-braider`. V2 uses
lane-specific `rg_white_linen_*`, `rg_etsy_waitlist_*`, and `rg_etsy_inquiry_*`
identifiers. Delivery, attribution, and consent timestamps are bounded for all
versions.

## Audited target

- GCP project: `leadflow-review`
- Region: `us-central1`
- Firebase Frameworks service: `ssrleadflowreview`
- Baseline revision: `ssrleadflowreview-00264-xmm`
- Baseline source: PR-18 commit `09b5abf206928b1e699261a5dee81208ce96b995`
- Existing secret versions: `mission-control-crm-ingest-token:3` and
  `mission-control-crm-customer-id-hmac:3`

The live target had no `PAPERCLIP_*` bindings during audit, so the CRM reads the
Firestore projection. If any Paperclip binding appears before release, stop and
design a separately approved canonical write path; this receiver does not export
collector PII to Paperclip.

### Dependency security decision

The reviewed receiver release pins `next` and `eslint-config-next` to `15.5.22`
and overrides `websocket-driver` to `0.7.5`. Before creating a candidate, confirm
those exact resolved versions with `npm ls next eslint-config-next
websocket-driver --all`; a critical audit finding is a hard stop.

The current upstream tree still reports high findings through Sharp/PostCSS and
outbound Google/Twilio client dependencies. For this temporary exception,
`images.unoptimized` must remain enabled, the receiver must not process
attacker-controlled images, and the candidate must remain limited to the strict
JSON lead contract. Do not use `npm audit fix --force`, do not downgrade
`firebase-frameworks`, and do not override Sharp outside its declared peer
range. Track the compatible gRPC, protobufjs, Axios/FormData, and minimatch lock
cleanup as a separate tested release.

## Deterministic no-traffic candidate (do not run without release approval)

Set `$reviewedCommit` to the exact SHA supplied in the approved handoff. These
guards prevent deploying a mutable or different checkout:

```powershell
$reviewedCommit = '<REVIEWED_RELEASE_COMMIT_FROM_HANDOFF>'
$expectedBranch = 'codex/rosser-crm-receiver-release-20260726'
$actualBranch = (git branch --show-current).Trim()
$actualCommit = (git rev-parse HEAD).Trim()
$dirty = git status --porcelain
if ($actualBranch -ne $expectedBranch) { throw "Wrong branch: $actualBranch" }
if ($actualCommit -ne $reviewedCommit) { throw "Wrong commit: $actualCommit" }
if ($dirty) { throw 'Release worktree is not clean.' }
git merge-base --is-ancestor 09b5abf206928b1e699261a5dee81208ce96b995 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Reviewed baseline is not an ancestor.' }
git diff --check HEAD^ HEAD
if ($LASTEXITCODE -ne 0) { throw 'Release diff check failed.' }

$serviceBefore = gcloud run services describe ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format=json | ConvertFrom-Json
$liveTraffic = @($serviceBefore.status.traffic | Where-Object { $_.percent -gt 0 })
if (
  $liveTraffic.Count -ne 1 -or
  $liveTraffic[0].revisionName -ne 'ssrleadflowreview-00264-xmm' -or
  $liveTraffic[0].percent -ne 100
) {
  throw 'Mission Control traffic drifted from the audited 00264 baseline; re-audit.'
}
$paperclipNames = @($serviceBefore.spec.template.spec.containers[0].env | ForEach-Object { $_.name } | Where-Object { $_ -like 'PAPERCLIP_*' })
if ($paperclipNames.Count -gt 0) { throw 'Paperclip was enabled after audit; stop.' }

npm ci
npx vitest run tests/unit/rosser-gallery-collector-contract.test.ts `
  tests/unit/rosser-gallery-crm-config.test.ts `
  tests/unit/rosser-gallery-collector-ingest.test.ts `
  tests/unit/rosser-gallery-crm-visibility.test.ts `
  tests/smoke/rosser-gallery-collector-leads-route.test.ts
npm run build
gitleaks git --redact --no-banner --no-color

# Re-attest immediately before the first external mutation. Build output is ignored,
# but tracked source, branch, and commit must still be exactly the reviewed release.
$preDeployBranch = (git branch --show-current).Trim()
$preDeployCommit = (git rev-parse HEAD).Trim()
$preDeployDirty = git status --porcelain
if ($preDeployBranch -ne $expectedBranch) { throw "Branch changed: $preDeployBranch" }
if ($preDeployCommit -ne $reviewedCommit) { throw "Commit changed: $preDeployCommit" }
if ($preDeployDirty) { throw 'Tracked release source changed during verification.' }

$revisionsBeforeBuild = @(gcloud run revisions list `
  --service ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format='value(metadata.name)')
npm run deploy:firebase -- hosting:channel:deploy rosser-crm-receiver-20260726 `
  --project leadflow-review `
  --expires 7d `
  --non-interactive
$revisionsAfterBuild = @(gcloud run revisions list `
  --service ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format='value(metadata.name)')
$newCodeRevisions = @($revisionsAfterBuild | Where-Object { $_ -notin $revisionsBeforeBuild })
if ($newCodeRevisions.Count -ne 1) {
  throw "Expected one Firebase code revision, found $($newCodeRevisions.Count); stop."
}
$revisionAfterBuild = $newCodeRevisions[0]
$serviceAfterBuild = gcloud run services describe ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format=json | ConvertFrom-Json
$trafficAfterBuild = @($serviceAfterBuild.status.traffic | Where-Object { $_.percent -gt 0 })
if (
  $trafficAfterBuild.Count -ne 1 -or
  $trafficAfterBuild[0].revisionName -ne 'ssrleadflowreview-00264-xmm' -or
  $trafficAfterBuild[0].percent -ne 100
) {
  throw 'Firebase candidate changed production traffic; rollback and investigate.'
}
$codeCandidateImage = (gcloud run revisions describe $revisionAfterBuild `
  --project leadflow-review `
  --region us-central1 `
  --format='value(spec.containers[0].image)').Trim()

gcloud run services update ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --image $codeCandidateImage `
  --revision-suffix=rosser-crm-20260726 `
  --no-traffic `
  --tag rosser-crm-candidate `
  --update-secrets CRM_INGEST_TOKEN=mission-control-crm-ingest-token:3,ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET=mission-control-crm-customer-id-hmac:3 `
  --update-env-vars "ROSSER_GALLERY_CRM_OWNER_UID=fMsduRLGAQfk7BMFOe3N9kkIe8y2,ROSSER_GALLERY_CRM_WORKSPACE_ID=ws_cd43331c4b1648d0,ROSSER_GALLERY_CRM_BUSINESS_UNIT=rosser_nft_gallery,ROSSER_GALLERY_CRM_RELEASE_COMMIT=$reviewedCommit,ROSSER_GALLERY_CRM_CODE_REVISION=$revisionAfterBuild" `
  --quiet

$candidateService = gcloud run services describe ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format=json | ConvertFrom-Json
$candidateRevision = 'ssrleadflowreview-rosser-crm-20260726'
if ($candidateService.status.latestCreatedRevisionName -ne $candidateRevision) {
  throw 'The expected deterministic candidate revision was not created.'
}
$candidateTraffic = @($candidateService.status.traffic | Where-Object { $_.revisionName -eq $candidateRevision -and $_.percent })
if ($candidateTraffic.Count -gt 0) { throw 'Candidate unexpectedly has production traffic.' }
$candidateUrl = ($candidateService.status.traffic | Where-Object { $_.tag -eq 'rosser-crm-candidate' }).url
if (-not $candidateUrl) { throw 'Candidate tag URL was not assigned.' }
$configuredCandidateImage = (gcloud run revisions describe $candidateRevision `
  --project leadflow-review `
  --region us-central1 `
  --format='value(spec.containers[0].image)').Trim()
if ($configuredCandidateImage -ne $codeCandidateImage) {
  throw 'Secret-bound candidate does not use the reviewed Firebase candidate image.'
}
$candidateSpec = gcloud run revisions describe $candidateRevision `
  --project leadflow-review `
  --region us-central1 `
  --format=json | ConvertFrom-Json
$releaseCommitBinding = ($candidateSpec.spec.containers[0].env | Where-Object { $_.name -eq 'ROSSER_GALLERY_CRM_RELEASE_COMMIT' }).value
$codeRevisionBinding = ($candidateSpec.spec.containers[0].env | Where-Object { $_.name -eq 'ROSSER_GALLERY_CRM_CODE_REVISION' }).value
if ($releaseCommitBinding -ne $reviewedCommit -or $codeRevisionBinding -ne $revisionAfterBuild) {
  throw 'Candidate source attestation metadata does not match the reviewed build.'
}
```

`gcloud run services update` creates the secret-bound candidate revision. It is
the production enablement boundary but remains at zero percent traffic. The tag
URL is intentionally reachable for the authenticated, non-writing readiness check.

```powershell
$crmToken = (gcloud secrets versions access 3 `
  --secret mission-control-crm-ingest-token `
  --project leadflow-review).Trim()
$ready = Invoke-RestMethod -Method Get `
  -Uri "$candidateUrl/api/integrations/rosser-gallery/collector-leads" `
  -Headers @{
    Authorization = "Bearer $crmToken"
    'X-Correlation-Id' = 'rng-candidate-readiness-0001'
  }
if (-not $ready.ok) { throw 'Candidate readiness failed.' }
Remove-Variable crmToken
```

Do not POST the fixture to the tag or untagged production URL.

## Explicit promotion (separate approval)

Promote only the exact candidate revision captured above:

```powershell
gcloud run services update-traffic ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --to-revisions "$candidateRevision=100" `
  --quiet
```

After promotion, configure the RNG sender with the untagged endpoint and the same
ingest-token secret. Never give the sender the HMAC secret.

## Rollback

```powershell
gcloud run services update-traffic ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --to-revisions 'ssrleadflowreview-00264-xmm=100' `
  --quiet
gcloud run services update-traffic ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --remove-tags=rosser-crm-candidate `
  --quiet
```

Stop the sender immediately if credentials are suspected compromised, then rotate
the ingest token in both systems. Keep receipt, consent, and CRM records for audit;
rollback never deletes them automatically.

The scoped receiver adds no dependency. The audited baseline lockfile still has
23 inherited findings (11 moderate, 11 high, 1 critical). Record an explicit
accept/remediate decision before candidate creation; do not run an automatic audit
fix as part of this release.
