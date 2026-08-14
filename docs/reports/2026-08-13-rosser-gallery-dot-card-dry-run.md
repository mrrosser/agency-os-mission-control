# Rosser Gallery Dot-card dry-run — 2026-08-13

## Dataset and grain

- Source: local `dot_contact_export.csv` (not copied into the repository)
- Receipt: `sha256:fd37e8c56a5461bf6224ecfaa4e62a7b04f1df4d3f4fa9b889c4aff392ca1a4b`
- Size: 1,550 bytes
- Grain: 10 contact rows across 16 expected Dot export columns
- Brand: Rosser Gallery
- Mode: aggregate-only, dry-run review

## Quality findings

- 10/10 rows have a complete display-name basis.
- 10/10 rows have conservatively valid normalized email addresses.
- No normalized email, slug, name, phone, or exact-row duplicates were found.
- 9/10 rows contain a phone number; phones remain identity-only data with no
  SMS or calling authority.
- 10/10 meeting dates are parseable.
- Optional profile fields are sparse: website, address, company, job title, and
  personal notes are empty; this does not block a warm email review.

Confidence is high for this exact receipt. The parser verified the complete
expected header and every row width. A read-only canonical reconciliation was
then completed against the live `leadflow-review` registry.

## Consent and reconciliation posture

The workspace owner's statement that this original Rosser Gallery community
was approved to be contacted is recorded as cohort provenance. It is not used
to infer SMS, calls, scraping, social lookup, or direct-message permission.

The post-hardening live canonical dry-run (correlation
`6aa0ef27-a99e-44b9-adba-7940c86794c5`) reported:

- source rows: 10
- safe rows: 9 (6 new canonical people and 3 existing contacts)
- held rows: 1 (`canonical_identity_conflict`)
- proposed deterministic writes: 41
- plan fingerprint:
  `sha256:aacbb2a721bea4a7872e3effedc18f6ecea640430d35f09f483f3d0c8005ef47`
- ready for outreach: 0
- external actions performed: 0
- Firestore writes performed: 0

The held row remains untouched. The dry-run checked suppression documents and
contact-level suppression, related opt-out and transactional-only history,
identity matches, immutable no-send source/permission bindings, and open
conflicts. A live apply requires the exact workspace, exact receipt, and exact
fresh confirmation. A later warm-email pilot still requires its own exact
five-person approval.

## Reproduction

## Applied and verified

After independent review, the exact fresh plan was applied in one Firestore
transaction (correlation `8b87b846-ceac-48b6-826a-91f41665c731`):

- 9 safe rows applied; 1 identity-conflict row remained untouched.
- 41 writes committed: 6 people, 3 existing-person brand links, 6 email
  contacts, 8 identity-only phone contacts, 9 source records, and 9
  reconfirmation events.
- Plan fingerprint:
  `sha256:aacbb2a721bea4a7872e3effedc18f6ecea640430d35f09f483f3d0c8005ef47`.
- Drafts, sends, SMS, calls, social lookups, and external messages: 0.

The immediate post-apply canonical dry-run (correlation
`ea06e7d1-b66a-4f18-b10b-279707c1782e`) reported 9 already imported, the same
1 held conflict, 0 safe rows, and 0 proposed writes. See
`docs/runbook-rosser-gallery-card-import.md` for replay and compensation rules.
