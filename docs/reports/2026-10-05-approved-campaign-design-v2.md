# Approved v2 design for the exact five-person campaign

The revised owner email used the approved Library template and three CID images, but the real campaign executor still selected the earlier renderer and omitted those images. This local patch adds an explicit `approved_design_v2` campaign mode. It preserves the approved copy and artwork while using each frozen first-name greeting, the ordinary invitation subject, and the existing production recipient capabilities.

## Scope and boundaries

- A new campaign renderer reuses the exact pinned template and Nurturer, Gallery crest and RT logo bytes. The renderer rejects changed sender/footer/copy inputs. It uses production preference links and never converts campaign authority into `owner_qa`.
- A separate campaign MIME adapter pins the Gallery From/Reply-To, Marcus display name, approved subject, exact CID identities, file metadata and decoded image bytes. The HTML and plain text are trusted server-generated renderer outputs; their exact template, implementation and asset manifest are bound to the approval artifact. The reachable executor tests check the complete payload and malformed-render rejection before provider access.
- Pilot creation, review, approval fingerprints, idempotent comparison and the executor all retain the explicit mode. Fingerprints bind the exact rendered/MIME template, design version, asset manifest and implementation. Frozen audience fingerprints continue to bind each reviewed greeting.
- The UI offers the approved design explicitly and defaults new review forms to it. Saved pilots include an authenticated preview for the first frozen greeting, all reviewed greetings, and a plain-text alternative. Preview links are removed and the iframe remains sandboxed with no referrer. The preview contains unissued placeholders; no capability is created by review.
- Artwork approval applies to this mode. Legal identity, postal address, suppression, sender authentication, monitored replies, exact audience and dedicated sender gates are unchanged. The mode requires the reviewed Gallery sender, reply-to and postal footer.
- Existing owner v1/v2 renderers, MIME builders, IDs, artifact inputs, APIs, stored records and QA preference paths are unchanged. No campaign request accepts a QA capability. No contact permission or newsletter enrollment is inferred from an existing relationship or this invitation.

## Operational workflow and remaining delivery gates

After a separately reviewed release, an authenticated owner can select the exact five existing candidates and the approved design, provide the existing artwork evidence, and prepare a pilot through `POST /api/crm/warm-reconnect/pilots`. This creates a review record, not a send. Each recipient still needs a relationship decision bound to the current candidate/source fingerprint. The owner's collective confirmation may be recorded truthfully for each person without inventing an individual relationship category or newsletter consent.

Approval requires the exact artifact/audience/action fingerprints and truthful confirmations for every gate. Approval remains valid for 24 hours. The separate launch action records authority for exactly five one-time invitations; it does not invoke a provider. `POST /api/jobs/warm-reconnect` still requires the existing scheduler OIDC identity and the provider switch. It claims at most one recipient per call, enforces the 60-second minimum cadence, reloads suppression and permission evidence, and preserves durable no-retry behavior for uncertain outcomes. No owner-auth alternative, IAM grant, scheduler or bypass was added.

The parent reported fresh external blockers during this local task: authoritative DMARC was absent, the active DKIM selector was unverified, Workspace requested native password confirmation, and the existing principal lacked worker `getOpenIdToken` permission with no existing Scheduler target. These are not resolved or silently attested by this patch. This agent made no cloud calls, pilot writes, credential changes or sends. No release or live first-five execution was performed.

## Local verification

- Full unit/smoke suite: **1,767 tests / 255 files passed**, `crm-first-five-v2-full-tests-20261005.log`.
- Focused renderer/MIME/executor/owner compatibility: **71 tests / four files passed**, `crm-first-five-design-focused-final-20261005.log`.
- Activation/API/UI: **46 tests / three files passed**, `crm-first-five-v2-activation-tests-20261005.log`.
- Production build with explicitly synthetic public Firebase configuration passed, `crm-first-five-v2-build-20261005.log`. Standalone TypeScript passed, `crm-first-five-design-typecheck-final-20261005.log`.
- Full lint passed with zero errors and two unchanged callback warnings; scoped changed-file lint was clean. Dependency manifests are unchanged. A fresh registry audit was not run under the local-only instruction; the protected release pipeline retains that gate if release is later authorized.
- The new renderer's HTML and plain text are byte-identical to the approved owner v2 template after replacing only QA URL mode with production links. Tests cover five distinct frozen names, ten distinct recipient capability URLs, decoded exact CID image bytes, identity/asset/link tampering, artwork and domain confirmations, and pre-provider failure behavior.
- A deterministic baseline-versus-patched probe confirms both existing owner versions have identical renderer/MIME implementation fingerprints, rendered contracts, HTML/plain-text hashes and complete MIME hashes. Nine source dependencies match release commit `f44d083812a9cd5bf7188c37adb9e64a3a7944cb`. Receipt: `crm-first-five-v2-qa-compatibility-20261005.json`. This is local runtime evidence, not a live record migration or inbox-delivery claim.
- Exact private five-person HTML, inert previews, plaintext, MIME and their manifest remain outside the public patch at `output/warm-first-five-approved-v2-review-20261005/`. The 21 files use unissued synthetic capabilities and create no pilot or subscription. Actual names/addresses are not added to public source or tests.

The external immutable patch manifest records final whitespace, changed-source privacy and patch-only secret checks and the independent review. Passing local checks grants no send or deployment authority.
