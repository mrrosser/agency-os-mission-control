# Runbook: Social Draft Approvals in Google Space

Date: 2026-02-25  
Owner: Mission Control Ops

## What this does

Adds a draft-first workflow for social posts (IG Stories/Posts + FB Stories/Posts):

1. agent creates a social draft via API
2. Mission Control sends an approval card to Google Space (with image preview + video links)
3. operator clicks Approve or Reject directly from the Space card
4. decision is recorded on the draft in Firestore

No auto-posting is performed in this slice.

## Routes

- `GET /api/social/drafts` (auth required)  
- `POST /api/social/drafts` (auth required)  
- `POST /api/social/drafts/worker-task` (worker token)  
- `GET /api/social/drafts/{draftId}/decision` (tokenized approval link)

## Required env vars

- `SOCIAL_DRAFT_APPROVAL_BASE_URL`  
  - Public base URL used to generate approve/reject links.
  - Example: `https://leadflow-review.web.app`
- `SOCIAL_DRAFT_WORKER_TOKEN`  
  - Token for worker-task route.
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
- Approval state fields:
  - `status` (`pending_approval`, `approved`, `rejected`, ...)
  - `approval.tokenHash`
  - `approval.requestedAt`
  - `approval.expiresAt`
  - `approval.decision`
  - `approval.decidedAt`
  - `approval.decisionSource`

## Safety

- Tokenized links are hashed-at-rest (`approval.tokenHash`).
- Approval links expire (default 168h).
- Worker calls require `SOCIAL_DRAFT_WORKER_TOKEN` (or configured fallback worker token).
- External create action (Google Space post) is routed through idempotent API execution.
