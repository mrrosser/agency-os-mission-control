# Runbook: Social Draft Approvals in Google Space

Date: 2026-02-25  
Owner: Mission Control Ops

## What this does

Adds a draft-first workflow for social posts (IG Stories/Posts + FB Stories/Posts):

1. agent creates a social draft via API
2. Mission Control sends an approval card to Google Space (with image preview + video links)
3. operator clicks Approve or Reject directly from the Space card
4. decision is recorded on the draft in Firestore
5. approved drafts are auto-queued for external social execution handoff
6. dispatch worker drains queue to SMAuto MCP/webhook endpoint

No auto-posting is performed in this slice.

## Routes

- `GET /api/social/drafts` (auth required)  
- `POST /api/social/drafts` (auth required)  
- `POST /api/social/drafts/worker-task` (worker token)  
- `POST /api/social/drafts/rng-weekly/worker-task` (worker token, recurring-safe weekly idempotency)
- `POST /api/social/drafts/weekly/worker-task` (worker token, recurring-safe weekly idempotency for `rts|rng|aicf`)
- `POST /api/social/drafts/dispatch/worker-task` (worker token, drains `social_dispatch_queue` to SMAuto)
- `GET /api/social/drafts/{draftId}/decision` (tokenized approval link)
- `GET /api/social/onboarding/status` (auth required; onboarding checklist + social pipeline health)
- `POST /api/social/onboarding/status` (auth required; mark manual onboarding step complete/incomplete)

## Required env vars

- `SOCIAL_DRAFT_APPROVAL_BASE_URL`  
  - Public base URL used to generate approve/reject links.
  - Example: `https://leadflow-review.web.app`
- `SOCIAL_DRAFT_WORKER_TOKEN`  
  - Token for worker-task route.
- `SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS` (recommended for Scheduler OIDC)  
  - Comma-separated service account emails allowed to call worker routes with Google OIDC bearer tokens.
- `SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES` (optional)  
  - Comma-separated OIDC audience allowlist. Defaults to exact request URL when omitted.
- Google Space webhook (one of):
  - `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL` (default for all businesses)
  - `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RTS`
  - `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG`
  - `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_AICF`
- SMAuto dispatch:
  - `SMAUTO_MCP_SERVER_URL`
  - `SMAUTO_MCP_AUTH_MODE=none|api_key|id_token`
  - `SMAUTO_MCP_API_KEY` (required for `api_key`)
  - `SMAUTO_MCP_ID_TOKEN_AUDIENCE` (required for `id_token`)
  - `SMAUTO_MCP_PROTOCOL_VERSION` (optional; default `2025-03-26`)
  - `SMAUTO_MCP_SOCIAL_DISPATCH_TOOL` (optional tool name override; default `social.dispatch.enqueue`)
  - `SMAUTO_MCP_WEBHOOK_FALLBACK_ENABLED` (optional; defaults `true`)
    - set to `false` when SMAuto endpoint is MCP-only (JSON-RPC session based) to avoid duplicate fallback calls/cost
- Dispatch status notifications (optional):
  - `SOCIAL_DISPATCH_STATUS_NOTIFY` (`true`/`false`, default `true`)
  - `SOCIAL_DISPATCH_GOOGLE_CHAT_WEBHOOK_URL` (default)
  - `SOCIAL_DISPATCH_GOOGLE_CHAT_WEBHOOK_URL_RTS`
  - `SOCIAL_DISPATCH_GOOGLE_CHAT_WEBHOOK_URL_RNG`
  - `SOCIAL_DISPATCH_GOOGLE_CHAT_WEBHOOK_URL_AICF`
- Optional onboarding helper link:
  - `NEXT_PUBLIC_SOCIALOPS_CONNECTIONS_URL` (external SocialOps `/connections` URL shown in the onboarding checklist UI)

## Local worker example

```bash
curl -X POST http://localhost:3000/api/social/drafts/worker-task \
  -H "Authorization: Bearer ${SOCIAL_DRAFT_WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "DM5ZZngePXXhNgN85Afi7W4Knoz2",
    "businessKey": "rng",
    "channels": ["instagram_story", "facebook_post"],
    "caption": "Behind-the-scenes story draft with CTA.",
    "media": [
      { "type": "image", "url": "https://cdn.example.com/story-cover.jpg" },
      { "type": "video", "url": "https://cdn.example.com/story-clip.mp4", "title": "Story Clip" }
    ],
    "requestApproval": true
  }'
```

## OpenCall service runner (recommended)

Use the repo runner to trigger `POST /api/social/drafts/worker-task` with env-only secrets:

```bash
SOCIAL_DRAFT_BASE_URL=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app \
SOCIAL_DRAFT_WORKER_TOKEN=*** \
SOCIAL_DRAFT_UID=DM5ZZngePXXhNgN85Afi7W4Knoz2 \
SOCIAL_DRAFT_BUSINESS_KEY=rng \
SOCIAL_DRAFT_CHANNELS=instagram_post,facebook_post \
SOCIAL_DRAFT_CAPTION="RNG weekly drop teaser with CTA to profile link." \
SOCIAL_DRAFT_MEDIA_JSON='[{"type":"image","url":"https://cdn.example.com/rng-weekly.jpg"}]' \
npm run social:draft:run
```

Notes:
- Use the Cloud Run service URL for worker automation (current: `https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app`).
- Keep `https://leadflow-review.web.app` for operator/browser routes and approval callback base URL.
- Keep `SOCIAL_DRAFT_REQUEST_APPROVAL=true` so every draft goes through Space approval.
- Set `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG` to route RNG drafts into your phone-visible Space.

Dispatch drain runner:

```bash
SOCIAL_DISPATCH_BASE_URL=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app \
SOCIAL_DRAFT_WORKER_TOKEN=*** \
SOCIAL_DISPATCH_UID=DM5ZZngePXXhNgN85Afi7W4Knoz2 \
SOCIAL_DISPATCH_MAX_TASKS=10 \
SOCIAL_DISPATCH_RETRY_FAILED=false \
npm run social:dispatch:run
```

Dispatch smoke runner (safe default `dryRun=true`):

```bash
SOCIAL_DISPATCH_SERVICE_URL=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app \
SOCIAL_DRAFT_WORKER_TOKEN=*** \
SOCIAL_DRAFT_UID=DM5ZZngePXXhNgN85Afi7W4Knoz2 \
npm run social:dispatch:smoke
```

Non-admin acceptance probe (authenticated user route + approval link + dispatch drain):

```bash
SOCIAL_ACCEPTANCE_BASE_URL=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app \
SOCIAL_ACCEPTANCE_AUTH_MODE=user \
SOCIAL_ACCEPTANCE_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY} \
SOCIAL_DRAFT_WORKER_TOKEN=*** \
SOCIAL_ACCEPTANCE_UID=external-acceptance-20260226150304 \
SOCIAL_ACCEPTANCE_BUSINESS_KEY=rng \
SOCIAL_ACCEPTANCE_CHANNELS=instagram_post,facebook_post \
SOCIAL_ACCEPTANCE_DECISION=approve \
SOCIAL_ACCEPTANCE_DISPATCH_DRY_RUN=false \
npm run social:acceptance:nonadmin
```

Notes:
- This exercises a non-admin flow end-to-end:
  - user-authenticated draft creation (`POST /api/social/drafts`)
  - tokenized decision URL approval
  - dispatch drain verification via worker token.
- Set `SOCIAL_ACCEPTANCE_DISPATCH_DRY_RUN=false` for live dispatch verification.
- Use `SOCIAL_ACCEPTANCE_AUTO_DECISION=false` when you want manual approval tap-through instead of script-driven decision.

Manual dispatch curl:

```bash
curl -X POST https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app/api/social/drafts/dispatch/worker-task \
  -H "Authorization: Bearer ${SOCIAL_DRAFT_WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "DM5ZZngePXXhNgN85Afi7W4Knoz2",
    "maxTasks": 10,
    "retryFailed": false
  }'
```

Scheduler setup helpers:
- `scripts/social-dispatch-scheduler-setup.sh`
- `scripts/social-dispatch-scheduler-setup.ps1`

Default jobs created:
- `social-dispatch-drain` (`*/15 * * * *`) for pending queue drain
- `social-dispatch-retry-failed` (`0 3 * * *`) only when `SOCIAL_DISPATCH_RETRY_ENABLED=true`; otherwise the helper pauses this job to reduce noisy retry spend

## Weekly scheduler trigger (all businesses)

Use the weekly worker route to avoid duplicate replays across recurring runs. It derives a week key (`YYYY-Wnn`) and uses it as idempotency scope.

Manual token call:

```bash
curl -X POST https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app/api/social/drafts/weekly/worker-task \
  -H "Authorization: Bearer ${SOCIAL_DRAFT_WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "DM5ZZngePXXhNgN85Afi7W4Knoz2",
    "businessKey": "rng",
    "requestApproval": true,
    "source": "openclaw_social_orchestrator"
  }'
```

Cloud Scheduler OIDC hardening (recommended; removes static bearer header):

```bash
gcloud scheduler jobs update http social-drafts-rng-weekly \
  --project=leadflow-review \
  --location=us-central1 \
  --uri=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app/api/social/drafts/weekly/worker-task \
  --oidc-service-account-email=social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com \
  --oidc-token-audience=https://ssrleadflowreview-gdyt2qma6a-uc.a.run.app/api/social/drafts/weekly/worker-task \
  --remove-headers=Authorization
```

Then set runtime env:

```bash
SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS=social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com
```

Durability note:
- `.github/workflows/firebase-hosting-merge.yml` reapplies `SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS` and `SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES` after each deploy.
- Override those values through repo vars (`SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS`, `SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES`) so deploys do not drift.

Optional payload fields:
- `businessKey`: one of `rts`, `rng`, `aicf` (defaults to `rng`).
- `caption`: override generated weekly caption.
- `channels`: defaults to `["instagram_post","facebook_post"]`.
- `weekKey`: manual override for controlled replay/testing.

Recommended weekly jobs (America/Chicago):
- `social-drafts-rng-weekly`: `5 8 * * 1`
- `social-drafts-rts-weekly`: `10 8 * * 1`
- `social-drafts-aicf-weekly`: `15 8 * * 1`

Business-specific timezone overrides:
- `SOCIAL_DRAFT_WEEKLY_TIMEZONE` (global)
- `SOCIAL_DRAFT_RTS_WEEKLY_TIMEZONE`
- `SOCIAL_DRAFT_RNG_WEEKLY_TIMEZONE`
- `SOCIAL_DRAFT_AICF_WEEKLY_TIMEZONE`

## Authenticated operator example

Use an ID token in `Authorization: Bearer <firebase-id-token>`:

```bash
curl -X POST https://leadflow-review.web.app/api/social/drafts \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "businessKey": "rts",
    "channels": ["instagram_story", "facebook_post"],
    "caption": "Draft caption for RT promo",
    "media": [{ "type": "image", "url": "https://cdn.example.com/promo.jpg" }],
    "requestApproval": true
  }'
```

## Firestore storage

- Draft docs:
  - `identities/{uid}/social_drafts/{draftId}`
- External handoff queue docs:
  - `identities/{uid}/social_dispatch_queue/{queueId}` (`status=pending_external_tool`)
- Approval state fields:
  - `status` (`pending_approval`, `approved`, `rejected`, ...)
  - `approval.tokenHash`
  - `approval.requestedAt`
  - `approval.expiresAt`
  - `approval.decision`
  - `approval.decidedAt`
  - `approval.decisionSource`
  - `dispatch.status`
  - `dispatch.queueDocId`
  - `dispatch.queuedAt`
  - `dispatch.transport`
  - `dispatch.lastError`

## Safety

- Tokenized links are hashed-at-rest (`approval.tokenHash`).
- Approval links expire (default 168h).
- Worker calls require either `SOCIAL_DRAFT_WORKER_TOKEN` (or configured fallback worker token) or allowlisted Scheduler OIDC service accounts.
- External create actions use idempotency keys (`queueId`) when dispatching to SMAuto.

## Phone approval UX

1. Open Google Chat app (same Space webhook destination).
2. Open the Social Draft card and review caption/media previews.
3. Tap **Approve Draft** or **Reject Draft**.
4. Confirm success page in mobile browser (`Draft approved successfully.` or `Draft rejected successfully.`).
5. Approved drafts move to `identities/{uid}/social_dispatch_queue/*` with `status=pending_external_tool`.
6. Dispatch worker posts queued approved drafts to SMAuto and marks queue + draft `dispatch.status` as `dispatched`/`failed`.

## Production handoff checklist (M5 closeout)

- Runtime preflight: `GET /api/runtime/preflight` returns `status=ok` (no required/recommended failures).
- Dispatch schedulers enabled:
  - `social-dispatch-drain` (`*/15 * * * *`)
  - `social-dispatch-retry-failed` (`15 * * * *`)
- End-to-end live dispatch proof complete:
  - approved draft queued + drained with `attempted>0` and `dispatched>0`.
- External/non-admin acceptance proof complete:
  - authenticated user route creates draft (`POST /api/social/drafts`)
  - tokenized approval link decision works from browser/mobile
  - draft state transitions to `approved`
  - dispatch worker drains queue for that UID.

### Escalation path

1. If approval card does not arrive in Google Space, verify business webhook env vars and run `npm run social:draft:run`.
2. If approved drafts are not dispatching, run `npm run social:dispatch:smoke` (dry-run first, then live).
3. If dispatch fails with auth/connector errors, inspect runtime preflight + `SMAUTO_MCP_*` envs.
4. If scheduler drift occurs after deploy, re-verify jobs and Cloud Run envs using this runbook commands.
