# Google Workspace organization profiles

Mission Control has two canonical Google Workspace contexts:

| Organization | Business id | Google profile id |
| --- | --- | --- |
| RT Solutions | `rt_solutions` | `rt_solutions_work` |
| Rosser Gallery | `rosser_nft_gallery` | `rosser_gallery_work` |

`/api/google/status` returns both profiles by default. A caller can request one
exact context with `businessId` and/or `profileId`. An unknown value or a
business/profile mismatch returns HTTP 400. A selected profile never falls back
to the legacy account.

`/api/google/connect` accepts the same canonical context. The context is stored
in the one-time OAuth state and the callback writes credentials to that
profile's Secret Manager-backed schema-v2 account. Omitting both fields keeps
the legacy single-account behavior for existing callers.

## Run locally

Use the normal local environment variables; do not add OAuth secrets to source.
The redirect URI must end in `/api/google/callback` and match
`MISSION_CONTROL_PUBLIC_ORIGIN` when that origin is configured.

```powershell
npm ci --no-audit --no-fund
npm run dev
```

Run the fully mocked profile suite without opening Google OAuth:

```powershell
npx vitest run tests/unit/google-business-profiles.test.ts tests/unit/google-account-token-store.test.ts tests/unit/google-connect-route.test.ts tests/unit/google-callback-route.test.ts tests/unit/google-status-route.test.ts tests/smoke/google-workspace-connect.test.tsx
```

## Deploy and verify

1. Run lint, unit, smoke, typecheck, and build gates.
2. Merge through the protected repository workflow and deploy with
   `npm run deploy:firebase` (or the repository's main-branch deployment job).
3. Verify the public health endpoint and authenticated Google status response.
4. Do not copy legacy tokens into profile documents. If a profile is not bound,
   use its explicit Connect button and complete Google consent interactively.
5. Confirm each card reports only its own Gmail/Calendar/Drive capabilities.

The code recognizes existing schema-v2 bindings without migration. A user who
has only the legacy single-account document must explicitly connect each
organization. The legacy record remains readable for older callers during that
transition.
