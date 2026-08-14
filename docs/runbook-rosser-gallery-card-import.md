# Rosser Gallery Dot-card contact import

This workflow profiles a local Dot contact export and can reconcile it against
the canonical Rosser Gallery CRM. Dry-run is the default. Apply is available
only for the exact reviewed receipt and a freshly confirmed canonical plan.
Neither mode creates provider drafts or sends anything.

## Consent and channel boundary

The 2026-08-13 workspace-owner statement is preserved verbatim as cohort
provenance:

> These all do approved to be able to be contacted and tend to be our original
> fan base and community.

That statement supports review of a prior Rosser Gallery relationship. It does
not override canonical suppression, opt-out, transactional-only status, open
import conflict, or ambiguous identity. It does not assert a broad marketing
opt-in or attest SMS, calls, scraping, social lookup, or direct messages.
Imported email evidence is `reconfirm_required`; phones are identity-only.

## Local quality-only dry-run

Keep the CSV outside the repository. This command performs no Firestore read:

```powershell
npm run crm:rosser-gallery-card:dry-run -- "C:\private\dot_contact_export.csv"
```

It emits aggregate quality counts, the computed receipt, and a deterministic
local plan fingerprint. It has no apply mode.

## Canonical dry-run

Configure Application Default Credentials and set the trusted Firebase owner
identity in the process environment. The owner identity is deliberately not a
command-line argument.

```powershell
$env:ROSSER_GALLERY_IMPORT_OWNER_UID = "<trusted Firebase owner uid>"
$env:FIREBASE_PROJECT_ID = "<trusted Firebase project id>"
npm run crm:rosser-gallery-card:reconcile -- --file "C:\private\dot_contact_export.csv" --workspace-id "workspace_default_<trusted Firebase owner uid>"
```

The command computes the file receipt and accepts only:

```text
sha256:fd37e8c56a5461bf6224ecfaa4e62a7b04f1df4d3f4fa9b889c4aff392ca1a4b
```

It independently derives the canonical owner workspace and requires the
explicit `--workspace-id` value to match. It reads the active owner binding and
bounded workspace snapshots of `crm_people`, `crm_contact_points`,
`crm_source_records`, `crm_permission_events`, `crm_suppressions`, and
`crm_import_conflicts`. Output contains aggregate counts, a plan fingerprint,
and an apply confirmation string. It contains no names, emails, phones, local
path, row identifiers, notes, or locations.

## Exact apply semantics

Copy `apply.confirmationRequired` from a fresh canonical dry-run. Apply
requires all four explicit bindings: `--apply`, exact receipt, exact workspace,
and that confirmation.

```powershell
npm run crm:rosser-gallery-card:reconcile -- --file "C:\private\dot_contact_export.csv" --workspace-id "workspace_default_<trusted Firebase owner uid>" --apply --receipt "sha256:fd37e8c56a5461bf6224ecfaa4e62a7b04f1df4d3f4fa9b889c4aff392ca1a4b" --confirm "<apply.confirmationRequired from the fresh dry-run>"
```

Apply repeats the owner/workspace check and all canonical ledger reads inside
one Firestore transaction. Relevant state drift changes the plan fingerprint,
so a stale confirmation fails before writing. For each safe row only, the
transaction performs deterministic, additive writes:

- create a person only when no canonical email identity exists;
- add `rosser_gallery` with `arrayUnion` when an existing person lacks it;
- create an email point with `reconfirm_required` only when absent;
- create a phone point only for identity reconciliation, with no SMS or call
  permission;
- create an immutable Dot source record bound to the exact receipt and row
  fingerprint; and
- create a `historical_relationship_attestation_recorded` email permission
  event with `reconfirm_required`, `broadMarketingOptIn: false`, and
  `sendsAuthorized: false`.

Document IDs are deterministic and workspace-scoped. A fresh dry-run after a
successful apply reports those rows as `already_imported` with zero proposed
writes. A stale pre-import confirmation cannot be replayed.

Firestore rolls back the transaction if any pre-commit read, validation, or
write fails. There is no automatic compensating undo after a successful commit.
Before apply, retain the aggregate dry-run receipt and plan fingerprint. After
apply, immediately rerun the canonical dry-run and require exactly the applied
rows to report `already_imported`, held rows to remain held, zero proposed
writes, and zero external actions. If that verification differs, stop; do not
send or run a second apply, and prepare an explicitly reviewed compensating
plan from the deterministic document IDs.

Rows are held, with no writes for that row, for any of these conditions:

- malformed or duplicate source identity;
- multiple canonical email/phone matches, cross-person phone matches, or ID
  collisions;
- active address, domain, contact, person, or workspace suppression;
- any related `opted_out` or `transactional_only` state;
- unsupported permission state;
- open related import conflict;
- conflicting immutable source or permission binding; or
- per-ledger, total-document, or estimated-byte read bound exceeded.

Safe rows may be applied while held rows remain untouched. Import approval is
only CRM ingestion. It does not approve an audience, pilot, launch, delivery,
SMS, calls, social lookup, or direct messages.

## Activation boundary

Warm reconnect remains separately subject to a fresh suppression and consent
check, preference/unsubscribe controls, exact audience review, sender
readiness, and the approval-gated five-person pilot. This utility never invokes
that activation layer.

## Verification and deployment

```powershell
npx vitest run tests/unit/rosser-gallery-card-import.test.ts tests/unit/rosser-gallery-card-reconciler.test.ts
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

The utility is an operator-invoked CLI with no route or scheduler. Deploying
application code cannot start an import. Run it locally or from a controlled
Cloud Run job with Application Default Credentials and the trusted owner UID
and exact Firebase project provided by server environment variables. Never
commit credentials, the UID, or the CSV. No live apply was executed while
building the utility. The reviewed 2026-08-13 operator apply and immediate
aggregate-only verification are recorded in
`docs/reports/2026-08-13-rosser-gallery-dot-card-dry-run.md`.
