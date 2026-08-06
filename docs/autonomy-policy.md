# Agent autonomy policy foundation

Mission Control stores a separate autonomy policy for each authenticated operator. The policy has exactly two business scopes: `rt_solutions` (RT Solutions) and `rosser_gallery` (Rosser Gallery).

## Modes

- `assist`: prepare or recommend work; all consequential execution requires a person.
- `supervised`: orchestrate and stage safe work; execution still requires a person.
- `autonomous_safe`: an agent may execute only unprotected work when a complete trust envelope is present.

Missing, malformed, or unknown policy data resolves to `assist`. A stored or runtime global kill switch blocks execution. When multiple policy layers apply, the provider boundary must use `resolveMostRestrictiveAutonomyMode` from `lib/agents/autonomy-policy.ts`.

Actions are allowlisted. Unknown or misspelled action names block, and every known action requires its exact narrow scope in the execution envelope. Wildcard scopes are invalid.

The following actions can never be auto-approved by any mode: email send, public publish, SMS, voice call, spend, payment, contract, legal, pricing, final submission, and external calendar creation. They always require an explicit human approval in a separate approval workflow.

## Policy API

`GET /api/agents/autonomy-policy` returns the current policy, the latest 25 audit records, and the immutable mode/business/protected-action contract.

`PUT /api/agents/autonomy-policy` accepts:

```json
{
  "expectedVersion": 0,
  "globalKillSwitch": false,
  "businessModes": {
    "rt_solutions": "supervised",
    "rosser_gallery": "assist"
  },
  "executionEnvelope": {
    "agentId": "mission-control/operator",
    "delegatedBy": "owner",
    "scope": ["agent.autonomy_policy.update"],
    "trustLevel": "high",
    "evidenceRef": "operator:settings"
  },
  "idempotencyKey": "unique-request-key"
}
```

Both routes require Firebase bearer authentication and operator authorization. At least one of these environment allowlists must be configured:

- `AGENT_ACTION_ALLOWED_UIDS` (the existing Agent Nexus action allowlist)
- `AGENT_AUTONOMY_POLICY_ALLOWED_UIDS` (an optional narrower policy-admin allowlist)

If both are set, the authenticated UID must be in both. If neither is set, the API returns `403`. Do not commit real UIDs; supply them through the deployment environment or Secret Manager-backed deployment configuration.

Updates use both request idempotency and optimistic version checks. Firestore writes the policy document and immutable history entry in one transaction under `agentAutonomyPolicies/{uid}`. Client Firestore access remains denied; only the authenticated server API uses the Admin SDK.

## Provider-boundary contract

Provider routes are intentionally not wired in this foundation. Before a future provider call, the route must call `resolveAutonomyDecision` with:

- the authenticated user's stored policy;
- one of the two canonical business IDs;
- the requesting agent's mode;
- a narrowly named action;
- a complete execution envelope (`agentId`, `scope`, `trustLevel`, `evidenceRef`); and
- the runtime global kill-switch state.

Only `outcome: "auto_execute"` permits an unprotected provider call. `approval_required` must enter a human approval workflow; `blocked` must stop.

## Local verification

```powershell
$env:AGENT_ACTION_ALLOWED_UIDS="local-firebase-uid"
npm run lint
npx vitest run tests/unit/autonomy-policy.test.ts tests/unit/autonomy-policy-store.test.ts
npx vitest run tests/smoke/agents-autonomy-policy-route.test.ts
```

Use Application Default Credentials with the local Firebase project as documented elsewhere in this repository. Never commit credentials or access tokens.

## Cloud Run deployment

Deploy through the repository's existing Firebase/Cloud Run workflow. Add the operator allowlist to the service's environment configuration, confirm the runtime service account can read/write Firestore, then perform authenticated `GET` and stale-version `PUT` checks. A stale `expectedVersion` must return `409`; an unlisted UID must return `403`.
