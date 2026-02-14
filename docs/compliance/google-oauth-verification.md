# Google OAuth Verification + Custom Domain Checklist

This app uses Google OAuth for Drive/Calendar/Gmail access (beyond basic sign-in). Google requires:
- A domain you control (not `web.app` / `firebaseapp.com`) for consent screen "App domain" verification.
- Privacy Policy + Terms of Service hosted on that domain.
- OAuth verification for sensitive scopes (Drive/Gmail/Calendar).

This doc is the operator checklist to unblock external users.

## 1) Pick and verify a domain you control
1. Buy a domain (any registrar is fine).
2. Add it to Firebase Hosting as a custom domain:
   - Firebase Console -> Hosting -> Add custom domain
3. Complete the DNS records Firebase provides (TXT + A/AAAA / CNAME as instructed).
4. Wait for Firebase to show the domain as "Connected".

Recommended:
- Use the apex domain for marketing (`example.com`) and a subdomain for app (`app.example.com`).
- Point the OAuth consent screen "Application home page" to the app subdomain.

## 2) Host required links (Privacy + Terms) on the custom domain
This repo already serves:
- `/privacy`
- `/terms`

Once the custom domain is live, set:
- Privacy Policy URL: `https://<your-domain>/privacy`
- Terms of Service URL: `https://<your-domain>/terms`

## 3) Configure OAuth consent screen (Google Auth Platform)
Google Cloud Console -> Google Auth Platform:
- Branding
  - App name: use the same name shown in the product UI (e.g. "Mission Control").
  - User support email: your support inbox.
  - App domain:
    - Application home page: `https://<your-domain>/dashboard` (or `/`)
    - Privacy Policy: `https://<your-domain>/privacy`
    - Terms of Service: `https://<your-domain>/terms`
  - Authorized domains: add `<your-domain>` (must be verified by you).
- Audience
  - User type: External (for public usage).
  - Publishing status: Production (when ready).

## 4) Ensure OAuth client + redirect URIs match runtime
Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client:
- Authorized JavaScript origins:
  - `https://<your-domain>`
  - (optional) `http://localhost:3000` for local dev
- Authorized redirect URIs:
  - `https://<your-domain>/api/google/callback`
  - (optional) `http://localhost:3000/api/google/callback` for local dev

In runtime env vars (Cloud Run / Firebase frameworks SSR), set:
- `GOOGLE_OAUTH_REDIRECT_URI=https://<your-domain>/api/google/callback`

## 5) Minimize requested scopes (verification friction)
This app supports scope presets (Integrations -> Connect Google):
- Core: Drive + Calendar
- Full: adds Gmail

If verification is pending:
- Prefer "Core" to reduce scope footprint.
- Add Gmail only when needed.

## 6) Testing mode workaround (while verification is pending)
If the consent screen is still in Testing, only "Test users" can grant sensitive scopes.

Google Auth Platform -> Audience:
- Add test users (their Gmail addresses).

This is the fastest way to let a small set of users connect Drive/Calendar during verification.

## 7) Submit for verification
Google Auth Platform -> Verification Center:
- Complete branding requirements
- Provide a demo video / justification for each sensitive scope requested
- Submit

Notes:
- Restricted scopes may require additional security assessment; sensitive scopes require verification.
- Verification is a process gate; code changes cannot bypass it.

## 8) Post-verification sanity check
1. Sign in with a fresh Google account (not previously connected).
2. Integrations -> Connect Google (Core).
3. Operations -> Knowledge Base -> Browse Drive:
   - Picker opens and lists folders/files.
4. Run a dry-run lead scan to confirm Calendar/Gmail receipts succeed.
