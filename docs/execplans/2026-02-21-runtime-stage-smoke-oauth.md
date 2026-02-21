# ExecPlan: Runtime Lock + Stage Foundation + Competitor UI + Smoke + OAuth Readiness

## Goal
Deliver the selected roadmap batch:
1) runtime config lock checks,
2) deterministic stage-worker foundation,
3) competitor monitor dashboard UI,
4) post-deploy production smoke automation,
5) OAuth verification readiness pack.

## Scope
- Runtime preflight:
  - Add server-side runtime config checks.
  - Expose authenticated API for UI/runtime audits.
  - Surface status in Settings.
- Lead run staging:
  - Add stage model and persisted stage progress.
  - Attach stage progress on source and worker processing.
- Competitor UI:
  - Add dashboard page to create/list/run monitors and view reports.
  - Wire dashboard nav entry.
- Deployment smoke:
  - Add deploy smoke script (health/login/template/save/source/worker completion).
  - Run it automatically in main deploy workflow.
- OAuth readiness:
  - Add readiness checker helper + API endpoint + CLI script.
  - Document verification checklist and evidence requirements.

## DoD (Verification Gates)
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:smoke`
- [x] `npm run build`
- [x] `npm run check:oauth-readiness -- https://leadflow-review.web.app`

## Local Run / Verify
- `npm run dev`
- `npm run lint`
- `npm run test:unit`
- `npm run test:smoke`
- `npm run build`
- `npm run test:postdeploy` (requires GCP auth + Firebase API key/project env)

## Deploy
- Main workflow deploy + smoke:
  - `.github/workflows/firebase-hosting-merge.yml`
- Local deploy:
  - `npm run deploy:firebase -- leadflow-review`

## Notes
- No secrets committed; checks only validate presence/config state.
- Stage worker work in this change is a deterministic foundation (stage model + persistence), not a full multi-queue refactor.
