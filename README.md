# Agency OS Mission Control

Mission Control is a Next.js app with Firebase Auth + Firestore and server-side Google Workspace integrations (Gmail, Drive, Calendar).

## Local Development

### Prerequisites
- Node.js (LTS recommended)
- Firebase CLI (`npm i -g firebase-tools`)
- Google Cloud SDK (`gcloud`)

### Setup
1) Install dependencies:
   ```bash
   npm install
   ```

2) Copy env template and fill values:
   ```bash
   copy .env.local.example .env.local
   ```

3) Set required env values:
   - `NEXT_PUBLIC_FIREBASE_*` values from your Firebase project settings.
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.
   - Optional server-side secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`.

4) Provide credentials for Firebase Admin (server-only):
   - Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON key with Firestore access.
   - Or run locally with `gcloud auth application-default login` and set `FIREBASE_PROJECT_ID`.

5) Run the dev server:
   ```bash
   npm run dev
   ```

6) Connect Google Workspace:
   - Sign in and go to `Dashboard -> Integrations`.
   - Click **Connect Google** and complete the consent screen.

### Tests
```bash
npm test
```

## Google OAuth Setup

Configure OAuth consent and add redirect URIs:
- `http://localhost:3000/api/google/callback`
- `https://<your-domain>/api/google/callback`

Enable APIs in the Google Cloud project:
- `calendar.googleapis.com`
- `gmail.googleapis.com`
- `drive.googleapis.com`
- `people.googleapis.com`
- `secretmanager.googleapis.com`

## Deploy

### Option A: Firebase Hosting (Frameworks backend)
1) Ensure Firebase Hosting is initialized for this project.
2) Deploy:
   ```bash
   firebase deploy
   ```

### Option B: Cloud Run (direct)
1) Build and deploy:
   ```bash
   gcloud run deploy leadops-engine \
     --source . \
     --region us-central1 \
     --project <project-id>
   ```
2) Set env vars and secrets:
   ```bash
   gcloud run services update leadops-engine \
     --region us-central1 \
     --project <project-id> \
     --set-env-vars GOOGLE_OAUTH_CLIENT_ID=... \
     --set-env-vars GOOGLE_OAUTH_CLIENT_SECRET=... \
     --set-env-vars GOOGLE_OAUTH_REDIRECT_URI=... \
     --set-env-vars FIREBASE_PROJECT_ID=... \
     --set-env-vars TWILIO_ACCOUNT_SID=... \
     --set-env-vars TWILIO_AUTH_TOKEN=... \
     --set-env-vars ELEVENLABS_API_KEY=... \
     --set-env-vars HEYGEN_API_KEY=...
   ```

### Firestore Rules
Deploy rules when they change:
```bash
firebase deploy --only firestore:rules
```
