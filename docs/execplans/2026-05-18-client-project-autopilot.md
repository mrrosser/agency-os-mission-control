# Client Project Autopilot ExecPlan

## Goal
Implement the Mission Control side of a client-project-only autofix workflow that can queue bounded fixes, enforce allowlists and kill switches, collect evidence, and block client follow-up until verification is green.

## Scope
- Add the `ClientAutofixRun`, registry, and `EvidenceBundle` contracts.
- Add authenticated run/history/status API routes under `/api/agents/client-autofix`.
- Encode the SocialOps client-project adapter defaults.
- Require tests, route checks, screenshot evidence, trace evidence, and a client-visible URL before client follow-up is marked ready.
- Preserve `push_blocked_missing_remote` when a registry entry has no GitHub URL.

## Verification
- `npx vitest run tests/unit/client-autofix.test.ts tests/smoke/agents-client-autofix-route.test.ts`
- `npx eslint lib/client-autofix.ts app/api/agents/client-autofix/route.ts "app/api/agents/client-autofix/[runId]/route.ts" tests/unit/client-autofix.test.ts tests/smoke/agents-client-autofix-route.test.ts`
- `npx tsc --noEmit --pretty false` remains blocked by unrelated pre-existing test type errors outside the new client-autofix files.

## Current Status
Implemented and locally verified with targeted tests. Live Beth/Fortifyy follow-up remains blocked until authenticated SocialOps UI evidence exists.
