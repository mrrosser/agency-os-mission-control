# LeadFlow Mission Control

Lead generation command center: source leads, score them, and visualize the outreach journey across MCP + AI steps. Built as a Firebase-backed Next.js app with a real-time dashboard and an API vault for tenant-specific keys.

## Run Locally
1) Install deps:
```bash
npm ci
```
2) Create `.env.local` from the template:
```bash
copy .env.local.example .env.local
```
3) Fill in required values in `.env.local`:
- `NEXT_PUBLIC_FIREBASE_*` (Firebase web app config)
- `FIREBASE_PROJECT_ID`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- Optional: `GOOGLE_PLACES_API_KEY` (for live lead sourcing)
- Optional: `TWILIO_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`

4) Start dev server:
```bash
npm run dev
```

## Lead Sourcing + Scoring
- The Lead Engine lives in `app/dashboard/operations`.
- If `GOOGLE_PLACES_API_KEY` (or a user-scoped secret `googlePlacesKey`) is set, live lead sourcing is enabled.
- Without a Places key, the Lead Engine pulls from existing CRM leads.

## Google OAuth Redirect URIs (recommended)
- Local: `http://localhost:3000/api/google/callback`
- Production: `https://leadflow-review.web.app/api/google/callback`

## Deploy (Firebase Hosting)
The workflow `.github/workflows/firebase-hosting-merge.yml` deploys on push to `main`.

Required GitHub Actions secrets:
- `ENV_LOCAL` (full `.env.local` content)
- `FIREBASE_SERVICE_ACCOUNT_LEADFLOW_REVIEW` (Firebase Admin SDK JSON)

Expected live URL (Firebase Hosting default):
- `https://leadflow-review.web.app/`

## Troubleshooting
- If `/api/*` requests return HTML (e.g. `Unexpected token '<'`) or 403s, the Firebase frameworks SSR service may not be invokable.
- Ensure the Cloud Run service is public-invoker (the APIs still enforce Firebase ID tokens per-route):
```bash
gcloud run services add-iam-policy-binding ssrleadflowreview \
  --project leadflow-review \
  --region us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

## Tests
```bash
npm test
```

## Repo Notes
- Core app code: `app/`, `components/`, `lib/`, `tests/`
- Unrelated or archived materials are staged under `please-review/`
