# Plain-text warm reconnection: local review

Prepared 2026-10-03 in the isolated `rt-sending-local-20261003` clone. This report describes local implementation and mocked validation, not a deployment or campaign authorization.

## Implemented contract

- `contentMode: "plain_text"` produces a single-part UTF-8 `text/plain` MIME message with no HTML or artwork. The renderer does not read the artwork in this mode.
- Missing `contentMode` retains the legacy `artwork_html` behavior. Unknown/null modes fail closed.
- Plain-text creation omits the artwork approval field; stored pilots use `artworkEmailApproval: null`. Plain-text approval omits artwork confirmation and has no artwork gate. Providing a false artwork attestation is rejected.
- Artwork mode retains its required creation evidence and explicit approval confirmation. The remaining identity, postal address, preferences/unsubscribe, suppression, domain authentication, reply-to, audience, and Google-account gates remain in force for both modes.
- Fingerprints include the resolved mode, rendered content and actual MIME. Changing mode invalidates approval. Idempotency comparison includes mode, and the executor forwards it through rendering and MIME delivery.
- Both modes retain the visible human preferences/unsubscribe URL, distinct one-click capability, `List-Unsubscribe`, and `List-Unsubscribe-Post` headers. There is no new newsletter opt-in or inferred permission.
- The delivered copy contract now matches the separately reviewed October 3 Rosser Gallery / RT.Solutions interest-choice copy.

## Verification

- Focused suites passed: renderer 4, MIME 31, activation 15. The final activation run includes the regression requiring artwork confirmation for artwork and preserving non-artwork confirmations for plain text. The parent owns the combined final suite.
- API route smoke suite: 11 tests passed, including mode/artwork schema rejection cases and dedicated RT profile selection.
- Focused ESLint and `git diff --check` passed.
- Independent review found no plain-text-to-HTML or artwork-approval bypass. Invalid modes fail closed; suppression, capability URL and exact-approval checks remain intact.
- The first full TypeScript check found only missing RT sender constant imports in the separately edited executor sender policy. The parent corrected those imports and owns final build verification.

## Deployment consideration

Existing stored pilots use implementation-bound fingerprints. Any pilot saved before this change (including a stopped pilot) will fail current fingerprint materialization. The activation GET currently materializes every returned pilot, so old pilots can make the entire review unavailable with a 409. Reapproval/stop also fail closed on drift. Before deployment, verify that there are still no persisted pilots or implement an explicit stale-pilot recovery workflow. Do not silently renew or convert old approvals.

No OAuth, provider call, credential change, deployment, import, email send or public test submission was performed for this implementation.
