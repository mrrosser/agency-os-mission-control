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

No auto-posting is performed in this slice.

## Routes

- `GET /api/social/drafts` (auth required)  
- `POST /api/social/drafts` (auth required)  
- `POST /api/social/drafts/worker-task` (worker token)  
- `POST /api/social/drafts/rng-weekly/worker-task` (worker token, recurring-safe weekly idempotency)
- `GET /api/social/drafts/{draftId}/decision` (tokenized approval link)

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
SOCIAL_DRAFT_BASE_URL=https://ssrleadflowreview-450880825453.us-central1.run.app \
SOCIAL_DRAFT_WORKER_TOKEN=*** \
SOCIAL_DRAFT_UID=DM5ZZngePXXhNgN85Afi7W4Knoz2 \
SOCIAL_DRAFT_BUSINESS_KEY=rng \
SOCIAL_DRAFT_CHANNELS=instagram_post,facebook_post \
SOCIAL_DRAFT_CAPTION="RNG weekly drop teaser with CTA to profile link." \
SOCIAL_DRAFT_MEDIA_JSON='[{"type":"image","url":"https://cdn.example.com/rng-weekly.jpg"}]' \
npm run social:draft:run
```

Notes:
- Use the Cloud Run service URL for worker automation (current: `https://ssrleadflowreview-450880825453.us-central1.run.app`).
- Keep `https://leadflow-review.web.app` for operator/browser routes and approval callback base URL.
- Keep `SOCIAL_DRAFT_REQUEST_APPROVAL=true` so every draft goes through Space approval.
- Set `SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG` to route RNG drafts into your phone-visible Space.

## Weekly RNG scheduler trigger

Use the weekly worker route to avoid duplicate replays across recurring runs. It derives a week key (`YYYY-Wnn`) and uses it as idempotency scope.

Manual token call:

```bash
curl -X POST https://leadflow-review.web.app/api/social/drafts/rng-weekly/worker-task \
  -H "Authorization: Bearer ${SOCIAL_DRAFT_WORKER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "DM5ZZngePXXhNgN85Afi7W4Knoz2",
    "requestApproval": true,
    "source": "openclaw_social_orchestrator"
  }'
```

Cloud Scheduler OIDC hardening (recommended; removes static bearer header):

```bash
gcloud scheduler jobs update http social-drafts-rng-weekly \
  --project=leadflow-review \
  --location=us-central1 \
  --uri=https://leadflow-review.web.app/api/social/drafts/rng-weekly/worker-task \
  --oidc-service-account-email=social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com \
  --oidc-token-audience=https://leadflow-review.web.app/api/social/drafts/rng-weekly/worker-task \
  --remove-headers=Authorization
```

Then set runtime env:

```bash
SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS=social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com
```

Optional payload fields:
- `caption`: override generated weekly caption.
- `channels`: defaults to `["instagram_post","facebook_post"]`.
- `weekKey`: manual override for controlled replay/testing.

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

## Safety

- Tokenized links are hashed-at-rest (`approval.tokenHash`).
- Approval links expire (default 168h).
- Worker calls require either `SOCIAL_DRAFT_WORKER_TOKEN` (or configured fallback worker token) or allowlisted Scheduler OIDC service accounts.
- External create action (Google Space post) is routed through idempotent API execution.

## Phone approval UX

1. Open Google Chat app (same Space webhook destination).
2. Open the Social Draft card and review caption/media previews.
3. Tap **Approve Draft** or **Reject Draft**.
4. Confirm success page in mobile browser (`Draft approved successfully.` or `Draft rejected successfully.`).
5. Approved drafts move to `identities/{uid}/social_dispatch_queue/*` with `status=pending_external_tool`.
