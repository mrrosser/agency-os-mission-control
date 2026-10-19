# Reviewed recipient greeting and opening

## Objective and boundary

Prepare local application support for recipient-specific plain-text greetings and first paragraphs in the existing approved campaign design. Proposed copy remains unapproved. This work performs no deployment, pilot creation, provider request, DNS lookup, contact change or consent write.

## Contract

- Keep the shared artifact, historical renderer and parent-content equality unchanged.
- Accept an optional bounded recipient-copy list at creation. Each entry binds the exact recipient/person/contact/email key and candidate fingerprint to a versioned greeting, opening and expected content fingerprint. Candidate identity does not verify contextual facts.
- Freeze content, renderer implementation and normalized rendered-output fingerprints into the recipient. Include the entire optional record in audience/action fingerprints and both creation replay identities. Existing records without it retain their prior fingerprint inputs.
- Expose exact full text for every recipient, including later variants, and require a current fingerprint-scoped copy confirmation in addition to relationship and permission review. Default assent is false and cannot carry across a changed pilot or content binding.
- Recompute the layer at approval, launch and executor boundaries. Render only frozen values, compare exact normalized output before provider access, and preserve prior-send, suppression, duplicate, cadence and ambiguous-outcome rules.

## Validation

Synthetic unit and route tests cover bounds, identity/content drift, approval and replay, unchanged shared artifacts, later-recipient previews, capability normalization and renderer mismatch. Existing activation, follow-on and executor regression suites run under an offline network guard with provider execution disabled and credential environment excluded. Private packet mapping and rendered-copy reconciliation are outside the repository; no private contact fixtures enter source control.

## Status

Local implementation complete. Independent review found no open source issues. The full suite passed 2,362 of 2,370 tests; the eight sandbox-denied local gRPC tests subsequently passed in a focused 18-test rerun restricted to same-process loopback. New feature tests passed 79/79; independent focused verification passed 170/170. Type checking, lint and the patch secret scan pass.

The production build remains unvalidated: the offline guard blocked eight existing Google Fonts connection attempts, and the sandbox also denied a generated `.next/types` directory. No external connections executed. Production-bundled `Function.toString()` fingerprint parity is not established by the passing source/unit comparison. No release or real-recipient approval has been granted. See `docs/reports/latest-run.md` for the local evidence handoff.
