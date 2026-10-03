# Calendar event review repair

## Goal and authorization

Repair the existing Calendar setup gap and Create Event control, using existing Google work connections and exact owner approval. Scoped implementation, validation and protected deployment are authorized. No actual calendar event, invitation, new credential, OAuth grant, account default change, or retry of a previously blocked invitation is authorized during development/release.

Base: production/main `fc4e827cb3451fdb1146ab2b00aecf3c3c00ed0e`. Work in the isolated calendar release checkout; preserve original project repositories and the separately deployed contact site.

## Work

- [x] Inspect current account bindings, calendar routes and approval contracts.
- [x] Explicit work profile and concrete verified calendar selection; no default fallback.
- [x] Immutable saved review, fresh owner authentication, explicit approval, transactional claim, durable receipt and uncertain-write reconciliation.
- [x] Close legacy direct booking paths; preserve bounded selected-calendar reads.
- [x] Untrusted OpenClaw draft handoff to owner Calendar UI without new service authority.
- [x] Mock-based boundary tests and independent backend review; untitled Google event list defect corrected.
- [x] Complete UI regression checks (13/13 Chromium), fresh secret scan and final independent UI review.
- [x] Complete production build.
- [ ] Protected PR gates, merge/main deployment and read-only production verification.

## Definition of done

Full lint, unit/smoke, TypeScript, production build, unchanged high-severity audit and Gitleaks gates pass; local synthetic Playwright verifies approval/recovery without any live provider calls. Production verification checks source/revision alignment, account defaults/bindings, preserved runtime secret references and unauthenticated route boundaries. No real invitation or OAuth ceremony is used as a release test.

The protected PR/main pipeline is the release path. Do not bypass required checks or deploy a local synthetic browser-test build. If production verification fails, use the existing coordinated Hosting/SSR rollback process; do not reset request ledgers or credentials.

## Contracts and limits

Owner and OpenClaw workflow, endpoint retirement, storage/deduplication limits, recovery and v1 event constraints: `docs/calendar-event-review.md`.

Final evidence is recorded in `docs/reports/latest-run.md` and the local task workspace release receipts.
