# Google Workspace organization profiles

Mission Control has two canonical Google Workspace contexts:

| Organization | Business id | Google profile id |
| --- | --- | --- |
| RT.Solutions | `rt_solutions` | `rt_solutions_work` |
| Rosser Gallery | `rosser_nft_gallery` | `rosser_gallery_work` |

`/api/google/status` returns both profiles by default. A caller can request one
exact context with `businessId` and/or `profileId`. An unknown value or a
business/profile mismatch returns HTTP 400. A selected profile never falls back
to the legacy account.

`/api/google/connect` requires the same canonical context plus an explicit
scope preset. The context is stored
in the one-time OAuth state and the callback writes credentials to that
profile's Secret Manager-backed schema-v2 account. Context-free connection is
rejected. RT.Solutions and Rosser Gallery must use different verified Google
accounts so their stored credentials and approved capabilities remain isolated.

Generic Drive, Calendar, and Gmail tools use only the operator-selected
`defaultProfileId`. Mission Control never auto-selects the first connection.
A schema-v2 registry without a healthy default fails closed and never falls
back to plaintext legacy credentials. A secure profile reconnect removes the
legacy credential fields from the registry. A reconnect may retain an existing
refresh token only for the same stable Google subject, the same scope preset,
and the same normalized granted-scope set. Any scope or preset replacement must
return a new refresh token from Google. Connecting a different Google subject
to an occupied profile requires disconnecting that profile first.

An ordinary profile disconnect is deliberately local-only: it destroys that
Firebase user's selected profile secret and binding, but it does not call
Google's project-wide token revocation endpoint. This prevents one platform
user from invalidating another user's connection when both people happen to
authorize the same Google account. A future provider-wide "revoke everywhere"
operation requires a separately named, explicitly confirmed, globally
reference-counted design; it is not part of this endpoint.

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
5. Select which connected profile is the default for general Google tools.
6. Confirm each card reports only its own Gmail/Calendar/Drive capabilities.

The code recognizes existing schema-v2 bindings without guessing a profile. A
user who has only the legacy single-account document must explicitly connect
each organization. Pre-v2 legacy access remains a narrow transitional fallback
only until schema v2 is created; it is never used once profile storage exists.
