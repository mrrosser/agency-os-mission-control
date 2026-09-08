## Summary

Repair the production CRM crash before sign-in and deliver the reviewed mobile CRM workbench and first-party business contact cards.

- Preserve nonempty Firebase runtime defaults, use statically addressable public env references, and read server configuration at request time. Five-field hosting defaults work for Auth/Firestore without inventing appId.
- Add an independent readable recovery screen. Exact public preferences/contact-card routes do not eagerly load private workspace providers.
- Add People, Outreach, Share cards and Activity workspaces, quick actions, search/business filters, accessible keyboard/modal behavior and reduced-motion styling.
- Publish two public business contact cards with social links, vCards and independently decoded QR downloads. Public action props/modules exclude private CRM operational notes.
- Preserve existing Second Brain Secret Manager references during framework deployment. Validate production warm-send capability explicitly and force it off on PR preview runtimes.

## Production baseline reconciliation

Remote main is `4d3413fa8a5a8085bbaadc3de8e6c86b4fc9012c`, but the currently deployed layout bundle byte-for-byte matches local source commit `36f5d2fc2e3b11598fcde9e41b6066be17361385`.

This PR preserves two already-deployed, previously local-only commits:

- `a251df2`: governed Second Brain review desk, authenticated/scoped APIs, contract/runbook/tests (31 files, +3,064 lines).
- `36f5d2f`: bounded Firebase framework discovery timeout and tests (4 files, +65/-7 lines).

They cover 34 distinct files combined. Cherry-picking only the new CRM repair onto the old main would remove that existing production functionality. Review these antecedents as baseline reconciliation, not as unrelated new live features. Other open PRs are not merged or bundled.

## Approval and sending boundaries

Marcus approved publication with email capability enabled. This is not approval to send a newsletter, create/launch a reconnect pilot, select recipients, enroll contacts or create a paid checkout. Existing exact-recipient/content approval, suppression, OAuth scope and launch controls remain intact.

**Release hold:** the saved Gallery OAuth rule requires `mrosser@rossernftgallery.com`, but a fresh in-memory, nonpersisted refresh resolved the connected identity to `mrosser@rossergallery.com`. User reconciliation is pending. The existing broad OAuth grant also fails the dedicated `gmail_send` scope requirement. Do not set the production capability variable to true or claim sending-ready until these checks are handled. Do not use the legacy default-profile Gmail route as a Gallery fallback.

The last fresh audit found zero warm pilot records and zero warm-reconnect scheduler jobs; the live warm-send flag was absent/off. The flag applies to the warm-reconnect executor only, not all email features. Enabling alone is not a campaign launch and creates no schedule.

## Verification

Fresh final candidate: full lint (zero errors, three pre-existing warnings), 737 unit tests across 144 files, 245 smoke tests across 88 files, production build/typecheck, 14 recovery/public-route browser scenarios and two mocked desktop/mobile CRM workflows passed. The tests did not make external sends or writes. Desktop/mobile screenshots were visually reviewed. QR decode and high-severity dependency audit passed earlier with unchanged assets/dependencies; 13 moderate findings remain in unchanged dependencies.

Release-card changes have 12 passing scoped tests, including server-to-client serialization and recursive public import-graph isolation. Workflow/runtime preservation has 28 passing focused tests, both YAML files parse and all 24 workflow Bash blocks pass syntax checks. These tests are included in the fresh full suite. Full evidence is recorded in `docs/execplans/2026-09-08-crm-recovery-mobile.md`.

Fresh redacted Gitleaks checks found no leaks in the aggregate tracked diff from main or 28 new text files. Whitespace checks passed.

## Release and rollback

Respect the existing protected PR/main workflow: one approving GitHub review and strict/up-to-date `test` and `build_and_preview` are required, including for admins. Do not bypass this with raw live deployment or an admin merge.

Use the existing isolated SSR candidate, smoke, exact runtime/tag/Hosting-version verification and promotion path. Runtime secret references are preserved, not read or rotated. Capture fresh rollback evidence for both Cloud Run revision/rewrite tag and Hosting version; the historical August rollback channel is expired. The production smoke creates synthetic Auth/Firestore records and a dry-run lead worker job, with attempted cleanup; it does not send a newsletter.

Root force-dynamic affects rendering/cache behavior throughout the application. Landing, preferences, login/dashboard boundary and public cards are covered by production-start browser checks; production cost/load effects are not measured.

## Intake limitations

QRs currently open the existing live Gallery community and RT inquiry forms, not the new contact-card routes. Gallery submission-to-CRM receipt verification and RT's missing automatic CRM bridge remain separate work. Saving a vCard or scanning a QR never enrolls anyone in marketing. No contact-list imports or business-card photo ingestion are part of this release.
