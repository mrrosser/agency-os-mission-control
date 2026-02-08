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
- Optional: `FIRECRAWL_API_KEY` (for website enrichment during sourcing)
- Optional: `TWILIO_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`

4) Start dev server:
```bash
npm run dev
```

## Lead Sourcing + Scoring
- The Lead Engine lives in `app/dashboard/operations`.
- If `GOOGLE_PLACES_API_KEY` (or a user-scoped secret `googlePlacesKey`) is set, live lead sourcing is enabled.
- If `FIRECRAWL_API_KEY` (or a user-scoped secret `firecrawlKey`) is set, website enrichment can extract emails/signals to improve scoring.
- Without a Places key, the Lead Engine pulls from existing CRM leads.

## Google OAuth Redirect URIs (recommended)
- Local: `http://localhost:3000/api/google/callback`
- Production: `https://leadflow-review.web.app/api/google/callback`

Notes:
- Do not use `0.0.0.0` in OAuth redirect URIs; browsers treat it as an invalid address.
- If you run the dev server on a different port (e.g. 8080), add `http://localhost:8080/api/google/callback` to the Google OAuth client and set `GOOGLE_OAUTH_REDIRECT_URI` accordingly.

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
- The Frameworks backend memory is configured in `firebase.json` via `hosting.frameworksBackend.memory`.
- If `/api/*` intermittently returns HTML 502/503 and Cloud Run logs show memory OOM, you can bump the SSR service memory:
```bash
gcloud run services update ssrleadflowreview \
  --project leadflow-review \
  --region us-central1 \
  --memory 512Mi
```

## Tests
```bash
npm test
```

## Repo Notes
- Core app code: `app/`, `components/`, `lib/`, `tests/`
- Unrelated or archived materials are staged under `please-review/`
