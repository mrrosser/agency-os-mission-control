# Autonomous Second Brain Mission Control runbook

## Scope and invariants

Mission Control receives only sanitized candidate metadata and controller health. Raw
traces, source documents, and candidate skill bodies stay in the local encrypted
controller. Service routes use a dedicated bearer secret; reviewer routes require a
Firebase ID token plus an exact UID-and-email allowlist match. Human approval remains
mandatory for skill promotion.

Production target:

- Firebase project and Hosting site: `leadflow-review`
- Firebase frameworks Cloud Run backend: `ssrleadflowreview`
- Region: `us-central1`
- Canonical operator origin: `https://leadflow-review.web.app`

Do not deploy from a dirty worktree. Run the focused tests, the repository unit and
smoke suites, lint, and build from the release commit.

## Resolve reviewer identities

Use Firebase Authentication in project `leadflow-review` to resolve each intended
reviewer's exact UID and normalized email. Do not guess either value. The same pair
must appear in both allowlists.

Set `SECOND_BRAIN_OPERATOR_UID` to the controller owner's exact Firebase UID and
store it in Secret Manager with the other runtime values. Candidate sync, service
decision reads, notifications, dashboard reads,
and direct reviews are all bound to that one Firestore operator subtree; a
service-supplied UID cannot select another subtree. The operator should be included
in the reviewer allowlists and must already have a valid Mission Control Gmail OAuth
connection. Additional allowlisted reviewers read and review the configured operator
subtree with their own audit identity, and do not need their own Gmail OAuth
connection.

## Create and populate secrets

Use these Secret Manager names:

- `second-brain-service-token`
- `second-brain-email-action-secret`
- `second-brain-review-allowed-uids`
- `second-brain-review-emails`
- `second-brain-operator-uid`

Create missing secrets with automatic replication:

```powershell
$ProjectId = "leadflow-review"
$SecretNames = @(
  "second-brain-service-token",
  "second-brain-email-action-secret",
  "second-brain-review-allowed-uids",
  "second-brain-review-emails",
  "second-brain-operator-uid"
)

foreach ($SecretName in $SecretNames) {
  gcloud secrets describe $SecretName --project $ProjectId --quiet *> $null
  if ($LASTEXITCODE -ne 0) {
    gcloud secrets create $SecretName --project $ProjectId --replication-policy automatic
    if ($LASTEXITCODE -ne 0) { throw "Could not create required secret: $SecretName" }
  }
}
```

Add each value through the Secret Manager console or
`gcloud secrets versions add <name> --data-file=-`. Never place a secret value in
the repository, a command argument, or a deployment log. The service token and email
action secret must be independently generated high-entropy values; the email action
secret must contain at least 32 characters. Store the comma-separated, exact reviewer
UIDs and normalized emails in their respective secrets. Store the exact selected
operator Firebase UID in `second-brain-operator-uid`; do not place it in a deploy
argument or repository file.

## Attach runtime configuration

Firebase frameworks deploys can replace the SSR revision, so attach the five secret
references after every deploy. First grant the deployed runtime service account
read access to the named secrets:

```powershell
$ProjectId = "leadflow-review"
$Region = "us-central1"
$Service = "ssrleadflowreview"
$SecretNames = @(
  "second-brain-service-token",
  "second-brain-email-action-secret",
  "second-brain-review-allowed-uids",
  "second-brain-review-emails",
  "second-brain-operator-uid"
)
$RuntimeServiceAccount = gcloud run services describe $Service `
  --project $ProjectId `
  --region $Region `
  --format "value(spec.template.spec.serviceAccountName)"

if ([string]::IsNullOrWhiteSpace($RuntimeServiceAccount)) {
  throw "Could not resolve the SSR runtime service account."
}

foreach ($SecretName in $SecretNames) {
  gcloud secrets add-iam-policy-binding $SecretName `
    --project $ProjectId `
    --member "serviceAccount:$RuntimeServiceAccount" `
    --role "roles/secretmanager.secretAccessor" `
    --quiet
  if ($LASTEXITCODE -ne 0) { throw "Could not grant access to: $SecretName" }
}
```

Deploy the verified commit through the existing preview-and-promote workflow, or run:

```powershell
npm run deploy:firebase -- leadflow-review
```

Then attach secrets and the public origin without exposing their values:

```powershell
gcloud run services update ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --update-secrets "SECOND_BRAIN_SERVICE_TOKEN=second-brain-service-token:latest,SECOND_BRAIN_EMAIL_ACTION_SECRET=second-brain-email-action-secret:latest,SECOND_BRAIN_REVIEW_ALLOWED_UIDS=second-brain-review-allowed-uids:latest,SECOND_BRAIN_REVIEW_EMAILS=second-brain-review-emails:latest,SECOND_BRAIN_OPERATOR_UID=second-brain-operator-uid:latest" `
  --update-env-vars "MISSION_CONTROL_PUBLIC_ORIGIN=https://leadflow-review.web.app" `
  --quiet
```

Verify only configuration names and secret references. Do not print resolved values:

```powershell
gcloud run services describe ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format "yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)"
```

Confirm all six runtime variable names are present, all five Second Brain values use
`valueFrom.secretKeyRef`, and `MISSION_CONTROL_PUBLIC_ORIGIN` is the only literal
environment variable in this set.

## Verification and canary gates

From the release worktree:

```powershell
npx vitest run tests/unit/second-brain-auth.test.ts tests/unit/second-brain-contract.test.ts tests/unit/second-brain-email-action-state.test.ts tests/unit/second-brain-email.test.ts tests/unit/second-brain-gmail-headers.test.ts tests/unit/second-brain-sync-state.test.ts
npx vitest run tests/smoke/agents-second-brain-decisions-route.test.ts tests/smoke/agents-second-brain-sync-route.test.ts tests/smoke/agents-second-brain-review-route.test.ts tests/smoke/agents-second-brain-notification-route.test.ts tests/smoke/agents-second-brain-email-action-route.test.ts
npm run lint
npm run build
```

Before live email:

The deployed code currently rejects every non-dry-run digest and urgent request. This is a
global kill switch, not a request-controlled feature flag. Keep it in place until the
controller has operation-specific receipt producers, seven independently re-verified cycles,
and a durable transactional email outbox. Omitting `dryRun` defaults to `true`.

1. An unauthenticated reviewer request returns `401`.
2. A Firebase user outside either allowlist returns `403`.
3. Missing either allowlist makes reviewer operations fail with `503`.
4. Candidate sync rejects raw trace or skill-body fields.
5. Service sync, decision, and notification requests with a UID other than
   `SECOND_BRAIN_OPERATOR_UID` return `403`.
6. An additional allowlisted reviewer sees and reviews the configured operator
   subtree while the review ledger records that reviewer's own UID and email.
7. Replaying the same sync or dry-run notification idempotency key does not duplicate
   state.
8. Dashboard metadata contains no raw traces or secret values.
9. Seven consecutive authenticated shadow cycles pass before a reviewed code change may
   remove the live-email kill switch.

Keep digest and urgent requests at `dryRun: true` during the canary. Promotion remains a
separate human-approved controller action. Candidate sync derives approval-owned state from
the authoritative decision ledger and rejects candidate-ID/hash reuse.

## Rollback

Before deploy, record the serving revision name without changing traffic:

```powershell
$PreviousRevision = gcloud run services describe ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --format "value(status.latestReadyRevisionName)"
```

If a production gate fails, stop live controller notifications and route Cloud Run
traffic back to that recorded revision:

```powershell
gcloud run services update-traffic ssrleadflowreview `
  --project leadflow-review `
  --region us-central1 `
  --to-revisions "$PreviousRevision=100" `
  --quiet
```

Retain the failed revision, correlation IDs, and sanitized receipts for diagnosis.
Do not delete candidate or review records during rollback.
