# Google OAuth and RT transition security scan — 2026-08-13

## Result

**PASS** for the frozen, non-build release gates in this report. The final
dependency gate has no high or critical vulnerability, the changed-file and
full-history secret scans have no finding, lint has no error, and the diff
check is clean.

This report does not claim a production build result. Build verification is a
separate release gate owned by the release operator.

## Frozen scope

- Repository branch: `codex/google-oauth-connection-repair-20260813`
- Release base/HEAD: `ba102ff04952e367d0ce740355366a78a0cf9f7b`
- Release-input files scanned: 121 modified or untracked files
- Manifest SHA-256: `f8d009408221cf97d74da988915f53db413563915e46137b6a8efd803b5e6d95`
- The manifest was hashed from sorted `path<TAB>file-sha256` records. A
  post-scan recheck matched the same count and hash exactly.
- This generated report is not part of the 121-file input hash.

## Gate evidence

| Gate | Tool/version | Exact command | Result |
| --- | --- | --- | --- |
| Lint | ESLint 9.39.2; Node.js v22.17.1 | `npm run lint` | PASS, exit 0: 0 errors and 3 non-blocking unused-variable warnings. |
| Dependency vulnerabilities | npm 11.6.2 | `npm audit --audit-level=high` | PASS, exit 0: 0 high, 0 critical, and 10 moderate transitive `uuid` findings. |
| Changed-file secrets | Gitleaks 8.30.0 | `gitleaks dir <temporary-changed-file-mirror> --gitleaks-ignore-path <empty-ignore-directory> --redact=100 --no-banner --no-color --report-format json --report-path <temporary-report>` | PASS, exit 0: approximately 1.60 MB scanned, 0 findings. |
| Reachable-history secrets | Gitleaks 8.30.0 | `gitleaks git . --log-opts="--all" --redact=100 --no-banner --no-color --report-format json --report-path <temporary-report>` | PASS, exit 0: 213 commits and approximately 7.96 MB scanned, 0 unignored findings. |
| Skill supply chain | Cisco AI Skill Scanner 2.0.13 | `uvx --from cisco-ai-skill-scanner==2.0.13 skill-scanner scan-all skills --recursive --use-behavioral --fail-on-findings --format sarif --output-sarif <temporary-report>` | PASS, exit 0: 0 warning/error findings; 11 note-only `MANIFEST_MISSING_LICENSE` results. |
| Whitespace/errors | Git 2.52.0.windows.1 | `git diff --check HEAD` | PASS, exit 0. Git emitted informational LF-to-CRLF working-copy warnings only. |
| MCP supply chain | Not applicable | Not run | No MCP server or MCP tool source is in the changed-file manifest. |

All secret-scan output used 100% redaction. Temporary scanner artifacts were
kept outside the repository and contain no unredacted values in this report.

## Dependency remediation and residuals

The first dependency run correctly stopped on
`GHSA-2v37-7h3g-55p8` (`nanoid <3.3.18`). The affected chains were:

- root -> `next@15.5.22` -> bundled `postcss@8.5.23` -> `nanoid@3.3.17`
- root -> `@tailwindcss/postcss@4.1.18` -> `postcss@8.5.26` ->
  `nanoid@3.3.17`
- root -> `vitest@3.2.6` -> `vite@7.3.6` -> `postcss@8.5.26` ->
  `nanoid@3.3.17`

Both PostCSS ranges accept `nanoid@3.3.18`. The release owner applied a
semver-compatible override and lockfile resolution to 3.3.18, then the exact
final-tree audit passed.

Ten moderate transitive `uuid` findings remain. npm's offered complete fix
would force a breaking Firebase Admin change, so no automatic
`npm audit fix --force` was run. They do not fail the configured high-severity
gate, but should remain on the dependency-maintenance backlog.

## Secrets and PII review

No raw secret, email address, phone number, or contact-record value was printed
or copied into this report.

A count-only scan of added content found 22 email-like strings, 2 phone-like
strings, and 34 broad credential-assignment-like strings. Every candidate is
confined to the following unit-test fixtures:

- `tests/unit/google-account-token-store.test.ts`
- `tests/unit/google-callback-route.test.ts`
- `tests/unit/google-oauth-account-email.test.ts`
- `tests/unit/google-oauth-account-tokens.test.ts`
- `tests/unit/google-oauth-scope-presets.test.ts`
- `tests/unit/google-status-route.test.ts`
- `tests/unit/google-verification-readiness.test.ts`
- `tests/unit/rosser-gallery-card-import.test.ts`
- `tests/unit/rosser-gallery-card-reconciler.test.ts`
- `tests/unit/warm-reconnect-google-account-binding.test.ts`

The email/phone candidates are reserved examples, 555-number fixtures, or a
redacted URL-userinfo SSRF fixture. Credential-like assignments are explicit
mock token/secret fixtures. Gitleaks independently found none of them to be a
credential. No contact CSV, provider export, live credential, or personal
contact record is present in the release manifest.

## Known historical false-positive policy

The existing `.gitleaksignore` contains two pre-existing, reviewed,
exact-fingerprint allowances for synthetic idempotency values in:

- `tests/smoke/agents-actions-route.test.ts`
- `tests/smoke/telemetry-retention-run-route.test.ts`

They are limited to the historical commit, file, line, and
`generic-api-key` rule fingerprint. There is no path-wide, rule-wide,
regex-wide, or value-wide suppression. Neither fixture produced a new finding
in the changed-file scan.

## Changed-file manifest

```text
.github/workflows/firebase-hosting-merge.yml
.github/workflows/firebase-hosting-pull-request.yml
app/api/agents/control-plane/route.ts
app/api/crm/customers/route.ts
app/api/google/callback/route.ts
app/api/google/connect/route.ts
app/api/google/default-profile/route.ts
app/api/google/disconnect/route.ts
app/api/google/status/route.ts
app/api/google/verification-readiness/route.ts
app/api/lead-runs/[runId]/jobs/route.ts
app/api/leads/source/route.ts
app/api/leads/templates/route.ts
app/api/revenue/automation/daily/worker-task/route.ts
app/api/social/drafts/route.ts
app/api/social/drafts/weekly/worker-task/route.ts
app/api/social/drafts/worker-task/route.ts
app/api/twilio/make-call/route.ts
app/dashboard/crm/page.tsx
app/dashboard/integrations/page.tsx
app/dashboard/operations/page.tsx
app/dashboard/settings/page.tsx
app/help/google-oauth/page.tsx
components/crm/warm-reconnect-activation.tsx
components/integrations/google-oauth-callback-feedback.ts
components/integrations/google-status-request-gate.ts
components/integrations/GoogleOAuthCallbackFeedback.tsx
components/integrations/GoogleWorkspaceConnect.tsx
components/settings/GoogleWorkspaceSettingsNotice.tsx
docs/execplans/2026-08-13-aicf-operational-retirement.md
docs/execplans/2026-08-13-google-oauth-connection-repair-rt-transition.md
docs/google-oauth-verification-readiness.md
docs/google-workspace-multi-profile.md
docs/reports/2026-08-13-rosser-gallery-dot-card-dry-run.md
docs/runbook-rosser-gallery-card-import.md
lib/agents/autonomy-runtime.ts
lib/agents/registry.ts
lib/crm/customer-memory.ts
lib/crm/rosser-gallery-card-import.ts
lib/crm/rosser-gallery-card-reconciler.ts
lib/crm/warm-reconnect-activation-types.ts
lib/crm/warm-reconnect-activation.ts
lib/crm/warm-reconnect-executor.ts
lib/crm/warm-reconnect-repository.ts
lib/google/account-token-store.ts
lib/google/oauth-state.ts
lib/google/oauth.ts
lib/google/verification-readiness.ts
lib/lead-runs/jobs.ts
lib/revenue/daily-automation.ts
lib/revenue/day1-automation.ts
lib/revenue/day30-automation.ts
lib/revenue/offers.ts
lib/runtime/preflight.ts
lib/secret-manager.ts
lib/social/dispatch.ts
lib/social/drafts.ts
lib/voice/call-audio.ts
lib/voice/inbound-webhook.ts
package-lock.json
package.json
public/openapi.yaml
README.md
scripts/backfill-paperclip-customers.mjs
scripts/revenue-automation-scheduler-setup.ps1
scripts/revenue-cadence-audit.mjs
scripts/revenue-day1-scheduler-setup.sh
scripts/revenue-day1-seed-templates.mjs
scripts/revenue-day2-scheduler-setup.sh
scripts/revenue-day30-scheduler-setup.sh
scripts/rosser-gallery-card-import-dry-run.mjs
scripts/rosser-gallery-card-reconcile.mjs
scripts/scheduler-consolidation-migrate.ps1
scripts/social-draft-run.mjs
scripts/social-nonadmin-acceptance.mjs
skills/cross-business-brain-service-lab/SKILL.md
skills/lead-comms-email-route-voices/references/routes/ai_cofoundry.md
skills/lead-comms-email-route-voices/SKILL.md
skills/sponsor-inbox-crm-agent/SKILL.md
tests/fixtures/prompt_guardrail_golden_set.json
tests/smoke/crm-customers-route.test.ts
tests/smoke/google-verification-readiness-route.test.ts
tests/smoke/lead-run-jobs-route.test.ts
tests/smoke/lead-templates-route.test.ts
tests/smoke/social-drafts-weekly-worker-task-route.test.ts
tests/smoke/social-drafts-worker-task-route.test.ts
tests/smoke/twilio-routes.test.ts
tests/unit/agent-registry.test.ts
tests/unit/autonomy-runtime.test.ts
tests/unit/deploy-workflow-env.test.ts
tests/unit/google-account-token-store.test.ts
tests/unit/google-callback-route.test.ts
tests/unit/google-connect-route.test.ts
tests/unit/google-default-profile-route.test.ts
tests/unit/google-disconnect-route.test.ts
tests/unit/google-oauth-account-email.test.ts
tests/unit/google-oauth-account-tokens.test.ts
tests/unit/google-oauth-callback-feedback-ui.test.tsx
tests/unit/google-oauth-callback-feedback.test.ts
tests/unit/google-oauth-scope-presets.test.ts
tests/unit/google-status-request-gate.test.ts
tests/unit/google-status-route.test.ts
tests/unit/google-verification-readiness.test.ts
tests/unit/google-workspace-connect-ui-contract.test.ts
tests/unit/google-workspace-settings-notice.test.tsx
tests/unit/inbound-voice-webhook.test.ts
tests/unit/outreach-followup-google-profile.test.ts
tests/unit/revenue-automation-scheduler-script.test.ts
tests/unit/revenue-cadence-audit.test.ts
tests/unit/revenue-daily-automation.test.ts
tests/unit/revenue-day30-automation.test.ts
tests/unit/revenue-offers.test.ts
tests/unit/rosser-gallery-card-import.test.ts
tests/unit/rosser-gallery-card-reconciler.test.ts
tests/unit/secret-manager-project-env.test.ts
tests/unit/settings-voice-profile-retirement.test.ts
tests/unit/social-drafts.test.ts
tests/unit/warm-reconnect-activation.test.ts
tests/unit/warm-reconnect-executor.test.ts
tests/unit/warm-reconnect-google-account-binding.test.ts
tests/unit/warm-reconnect-ui.test.tsx
```

## Release disposition

The non-build security gates are clear. Remaining non-blocking work is limited
to the moderate dependency backlog, the existing lint warnings, and optional
skill-license metadata cleanup.
