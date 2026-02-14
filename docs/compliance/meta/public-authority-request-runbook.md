# Public Authority Request Runbook

- Owner: Rosser NFT Gallery
- Effective date: 2026-02-12

## 1. Intake

1. Create a new row in `public-authority-request-log.csv`.
2. Assign internal request ID (format: `PAR-YYYYMMDD-###`).
3. Store original request artifacts in a restricted folder.

## 2. Verify authority and legal basis

1. Verify sender identity and official channel.
2. Record jurisdiction and legal instrument (statute, order, or equivalent).
3. If authenticity or legal basis is unclear, pause and request clarification.

## 3. Legality review (required before disclosure)

Checklist:

- Is the request lawful in the applicable jurisdiction?
- Is the request specific and scoped?
- Is the requested dataset necessary for stated purpose?
- Are there legal restrictions on notice/challenge?

Outcome options:

- `approve` (valid and scoped)
- `challenge` (overbroad/unlawful/unclear)
- `reject` (invalid)

Record decision and reasoning in request log.

## 4. Challenge process (when needed)

1. Send scope or legal clarification request.
2. Request narrowed timeframe, affected accounts, or data types.
3. Escalate to designated legal/compliance reviewer.
4. Update request log with challenge date and status.

## 5. Data collection and minimization

1. Limit extraction to approved scope (tenant, account, date range, fields).
2. Remove unrelated records.
3. Redact unnecessary values where possible.
4. Document exact fields disclosed.

## 6. Approval before release

1. Final approver signs off on disclosure package.
2. Confirm secure transfer method.
3. Record who sent, when sent, and what was sent.

## 7. Post-response closeout

1. Mark request status `closed`.
2. Attach response proof and references.
3. Set retention review date.

## 8. Minimum evidence package

For each request, retain:

1. Original request.
2. Legality review notes.
3. Challenge correspondence (if any).
4. Final disclosed dataset summary.
5. Approval record and transmission metadata.

