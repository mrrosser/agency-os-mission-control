# Runtime preservation for the CRM repair release

Correlation ID: `crm-recovery-runtime-preservation-20260908`.

Both Firebase workflows snapshot only the five existing, approved `SECOND_BRAIN_*`
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
applies and verifies the same runtime value. PR previews always use `false`,
including framework discovery, regardless of the repository variable or an older
`ENV_LOCAL` value. This setting is execution capability, not approval of a campaign,
audience, sender, or individual email; existing server approval gates still apply.

Local verification uses only synthetic Cloud Run metadata and mocked strings:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/firebase-preserved-runtime.test.ts tests/unit/deploy-workflow-env.test.ts
node node_modules/eslint/bin/eslint.js scripts/firebase-preserved-runtime.mjs tests/unit/firebase-preserved-runtime.test.ts tests/unit/deploy-workflow-env.test.ts
```

Deploy only through the reviewed branch/release workflow after normal release
approval and required checks. This change does not deploy, set the repository
variable, grant IAM, or send any message on its own.
