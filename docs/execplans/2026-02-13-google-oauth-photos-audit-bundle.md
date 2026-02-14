# ExecPlan: Google OAuth Presets, Places Photos, Run Audit, Bundle Trim

Date: 2026-02-13
Owner: Codex (pairing with repo owner)

## Goals
- Reduce Google OAuth friction by supporting incremental scope presets (Drive/Calendar vs Gmail).
- Make Google Drive Picker work without relying solely on a global env var by allowing the key to be set in API Vault.
- Enrich Google Places leads with photo references and display thumbnails in the lead receipt UI (without exposing Places API key).
- Add a run-level "Audit" view to confirm what actions occurred (email/calendar/drive) with timestamps + IDs.
- Reduce Firebase SSR function upload size by avoiding devDependencies in the generated frameworks function bundle.

## Non-goals (for this pass)
- Full Google verification/branding process (domain ownership, brand assets, compliance workflow).
- Caching/storing Places photos in Cloud Storage (proxy-only for now).
- Replacing `googleapis` entirely (bundle trim focuses on devDeps + obvious dead deps).

## Approach
1. Google OAuth presets:
   - Add `scopePreset` to `/api/google/connect`.
   - Generate auth URLs with `include_granted_scopes=true` so repeated connects expand scopes.
   - UI shows capabilities and offers "Enable Gmail/Drive/Calendar" when missing.
2. Picker API key:
   - Add `googlePickerApiKey` to secret resolution and API Vault UI.
   - `/api/drive/picker-token` resolves from user secret first, then env.
3. Places photos:
   - Map `photos[].photo_reference` from Places Details into the lead model.
   - Add an authenticated API proxy endpoint that returns the photo bytes.
   - UI fetches photo bytes via `fetch` + auth headers and renders via `blob:` URL.
4. Run audit:
   - Add an Audit drawer/modal on Operations to load `/api/lead-runs/:runId/receipts`.
   - Show per-lead action receipts (status, timestamps, external links).
5. Bundle trim:
   - Remove unused deps (e.g. `next-auth`).
   - Move type-only deps to `devDependencies`.
   - Add a deploy helper script that sets npm production flags for Firebase frameworks builds.

## Status (as of 2026-02-13)
- [x] OAuth scope presets + incremental connect UI
- [x] Picker API key configurable via API Vault + secret resolution
- [x] Places photo enrichment + authenticated photo proxy + receipt gallery
- [x] Operations run-level Audit drawer (timeline + IDs/links)
- [x] Bundle trim: remove `next-auth`, move `@types/matter-js`, set `NPM_CONFIG_PRODUCTION=true` for deploy

## Verification (DoD)
- `npm test`
- `npm run build`
- Smoke: Playwright login check (existing `tmp_playwright_login_check.mjs`)
- Manual: Integrations page shows capability chips and allows incremental connect.
- Manual: Lead receipt drawer shows a Places photo thumbnail when available.
- Manual: Audit drawer loads and shows receipts for a past run.

## Rollback
- Revert `scopePreset` support and default back to the full scope list.
- Remove photo endpoint + UI thumbnail (no schema migrations needed).
- Hide Audit drawer (no backend changes required to keep existing receipts).
- Deploy helper script is optional; removing it does not affect runtime.
