# Runtime preservation for the CRM repair release

Correlation ID: `crm-recovery-runtime-preservation-20260908`.

The production Firebase workflow snapshots only the five existing, approved `SECOND_BRAIN_*`
Secret Manager references from the revision currently serving 100% traffic before
framework deployment. Missing, duplicate, literal-valued, renamed, or non-`latest`
bindings stop the release. No secret value is read, logged, created, or rotated.
The temporary snapshot contains only approved environment names, secret resource
names, and version selectors.

The isolated no-traffic runtime receives those same references via
`--update-secrets`. Exact reference and send-switch verification follows runtime
creation; production also repeats it before traffic promotion and after Hosting
rebinding. Existing revision, image, traffic, Hosting-version/tag and rollback
checks remain intact. Rollback restores the previously captured runtime and
Hosting binding, without mutating secret versions or CRM records.

`vars.WARM_RECONNECT_PROVIDER_SEND_ENABLED` controls the production release and
defaults to `false`. Only the exact strings `true` and `false` are valid. The
workflow pins that value into its temporary `.env.local` before building, then
applies and verifies the same runtime value. PR test/build validation always uses
`false`, regardless of the repository variable or an older `ENV_LOCAL` value.
This setting is execution capability, not approval of a campaign,
audience, sender, or individual email; existing server approval gates still apply.

## PR preview deployment is disabled

The required `build_and_preview` check still installs dependencies, runs tests and
builds, but publishes **no preview URL**. Its cloud authentication, WIF permission,
Hosting deployment and runtime mutation steps have been removed, with no repository
variable to re-enable them. Each run records this limitation in its step summary.
The protected production workflow and its existing rollback path are unchanged.

The prior shared-service PR path published Hosting before creating a corrected
no-traffic revision, without binding or proving that URL against the corrected
runtime. Checking that unused revision's send flag did not establish the public
preview's behavior. The existing production binding pattern depends on a live
traffic promotion, which must not be copied into a PR workflow. Independent preview
isolation and exact Hosting-to-runtime proof are future work requiring review.
No existing remote preview channel is deleted or modified by this local change;
older URLs must not be treated as safe or current validation evidence.

Local verification uses only synthetic Cloud Run metadata and mocked strings:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/firebase-preserved-runtime.test.ts tests/unit/deploy-workflow-env.test.ts
node node_modules/eslint/bin/eslint.js scripts/firebase-preserved-runtime.mjs tests/unit/firebase-preserved-runtime.test.ts tests/unit/deploy-workflow-env.test.ts
```

Deploy only through the reviewed branch/release workflow after normal release
approval and required checks. This change does not deploy, set the repository
variable, grant IAM, or send any message on its own.
