# First-five preference buttons

Local implementation and review only. No send, pilot, recipient capability, consent write, DNS change, scheduler change, grant or production release is authorized by this plan.

Scope extension: the owner subsequently authorized exactly one separate test to a typed personal Gmail address. This local patch adds its isolated backend and test-page mode; production release/execution must be reviewed first. It does not authorize the five-person campaign, DNS, IAM, OAuth or Scheduler changes.

## Behavior

- Keep the saved "A quick hello from Marcus" campaign and the five reviewed contacts. Revise only the preference instructions, greeting capitalization, links and email format.
- Add explicit `preference_buttons` format with three choices and a plain-text fallback. No artwork or tracking media.
- Choice and capability stay in the URL fragment. Opening the page only inspects the existing capability, clears the fragment and sets local selection. Explicit confirmation performs the existing preference POST. GET, HEAD and page load do not grant consent.
- Preserve exact-five approval fingerprints, sender identity pins, token scopes, expiry, suppression, request replay and unsubscribe-only header boundaries.
- Retain the owner-accepted postal footer and add both business websites. Do not convert relationship recognition into newsletter opt-in.
- Uppercase only the first character of the first-name greeting frozen in the new pilot; do not edit canonical contacts.

## Acceptance and gates

1. Actual renderer produces three allowlisted choice URLs in both HTML and text with no images, scripts or forms.
2. Browser fixtures verify each selected choice, no load-time save, empty selection rejection, expired links and sticky opt-out.
3. Button mode passes activation, exact-five worker and multipart MIME fixtures. Existing invalidation and unsubscribe fixtures remain green.
4. Run unit/smoke tests, production build/typecheck, lint, dependency audit and patch secrets scan.
5. Package an immutable local patch, exact five review artifacts and readiness evidence. The separate one-owner test send is now explicitly authorized; the parent must review the new concrete production release scope before publication.

## Release constraints

Campaign version `2026-10-04.1`, renderer v2 and MIME v2 require a fresh exact review. Recheck that no live pilots exist before release; stored older fingerprint-bound pilots must never be silently migrated or approved. No existing owner-only test service was found. Do not invent a five-person pilot to send a one-owner test.

The added QA service freezes a fixed-recipient, fixed-Gallery-sender test separately, claims once, and never retries a provider attempt after ambiguity. Its four `crm_warm_reconnect_qa_*` namespaces are isolated from canonical contacts, consent, suppression, newsletters and campaign pilots. Capabilities are digest-only and typed to QA; explicit POST confirmation and unsubscribe affect QA state only. Use existing app-owner authentication. The existing worker OIDC mode is permitted by code, but the current tool principal lacks token impersonation permission; do not add IAM grants to make it available.

The completed owner panel is in the existing CRM Outreach tab. Its prepare/review/send/readback flow requires existing Firebase owner authentication; it never runs automatically. Final behavior and evidence are recorded in `docs/reports/2026-10-04-preference-buttons-owner-test.md`. No deployment or live test has occurred.
