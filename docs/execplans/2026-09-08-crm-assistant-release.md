# CRM Assistant publication approval

Correlation ID: `crm-assistant-release-20260908`.

Marcus explicitly approved publishing the locally tested conversational CRM first version and enabling a brief user-attended OpenAI/phone check on September 8, 2026. Repository: `mrrosser/agency-os-mission-control`; target: `leadflow-review`, Cloud Run `ssrleadflowreview` in `us-central1`, Hosting `https://leadflow-review.web.app`.

## Exact release scope

Branch `codex/crm-conversation-20260908`, based on released `6d79c844`. The Assistant UI, authenticated fixed CRM tools, bounded Responses and WebRTC gateways, optional WebMCP, local draft editing, related optional-onboarding error catch, tests, runbook, and default-off release flag plumbing are included. Existing dependencies and database rules are unchanged.

Normal commit, branch push, PR creation, required CI checks, protected merge and existing release smoke fixtures with cleanup are approved implementation steps. The two Assistant flags may be enabled through the existing repository-variable/runtime pipeline for the approved operator-started test. All five existing Second Brain references, Gallery sending configuration, existing branch protection and application authorization gates must be preserved. No admin bypass, direct deploy of the local synthetic build or new credentials in source.

## Excluded effects

No email send, campaign approval/launch, real contact import or enrollment, survey publication, checkout, new scheduler, unattended voice operation, purchase of API credits, secret replacement, OAuth consent on the user's behalf or microphone access without the user's explicit browser action. Existing no-extra-reviewer policy remains; removing the redundant reviewer never removes owner send confirmation.

## Evidence and release sequence

Local implementation evidence: full 1,112-test regression; final 125-test focused rerun; successful TypeScript/production build; zero lint errors; final three mocked production-start desktop/mobile cases; 34-file redacted secrets scan; zero high/critical dependency findings, 15 unchanged moderate findings. See the implementation ExecPlan and latest-run report for exact coverage and limitations.

Before merge, refresh live routing and capture coordinated Hosting version/rewrite tag, Cloud Run revision/image/traffic and preserved secret reference metadata. Recheck ancestry and exact required test/build statuses. Promote only through the existing workflow, which independently snapshots/rechecks bindings and rolls back both runtime and Hosting on failed promotion. Verify exact flags and matching live assets/runtime afterward. Stop if another release changes the baseline unexpectedly.

If existing OpenAI access is missing or inaccessible, report that setup requirement without manufacturing readiness, copying another user's key, silently migrating unrelated credentials, or bypassing workspace authority. Real speech quality and phone microphone permission remain user-attended validation, not something mocked tests establish.
