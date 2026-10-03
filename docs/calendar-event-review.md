# Calendar event review

The Calendar page uses an explicitly selected existing work connection. It no longer depends on a default Google account. The Create Event button prepares a saved review, and the owner approves that exact review before the server creates an event.

## Owner workflow

1. Open `https://leadflow-review.web.app/dashboard/calendar` while signed in as the active workspace owner.
2. Choose **Rosser Gallery** or **RT.Solutions**, inspect the freshly verified Google email, then select a concrete calendar. Read-only calendars can be viewed; creation requires both event-write scope and a writable calendar role.
3. Choose **Create Event**, enter the title, start/end local times, IANA timezone, guests, location and description, then **Prepare review**. Preparation reads account identity, calendar metadata and availability and saves a private request; it does not create an event or send invitations.
4. Review every displayed field. Guest events use `sendUpdates=all`; events with no guests use `none`. Review validity is 15 minutes and also ends when the event starts.
5. **Verify your identity** using the current app sign-in provider, after the review was prepared. Google and Apple use app-auth reauthentication; password sign-in asks for the existing password. No additional Google Calendar grant is requested. Unsupported/phone/custom sign-in must use a supported existing sign-in method personally; the app does not create credentials.
6. Check the initially unchecked approval box and choose **Approve and create event**. The server rechecks the selected binding, identity, permissions and availability before claiming and attempting the exact event once.
7. Save the resulting `?request=<id>` URL. A completed receipt confirms the Google event response or a later exact reconciliation; it does not prove invitation delivery.

Fresh authentication establishes fresh account credentials, not human presence or consent recognized by another execution environment. This workflow does not override external approval controls or authorize retrying an action blocked elsewhere.

## Recovery

Reloading a saved request only reads its state. It never approves or executes automatically. An already approved, unexpired request requires an explicit **Create approved event** click. A transport error requires checking the saved status first. `executing` and `unknown` permit read-only provider reconciliation, never another insert. A provider 404 after an attempted insert remains uncertain.

An expired unattempted or safely blocked review can be explicitly revised through a draft link and prepared again. Renewal keeps the stable request ID, changes the review fingerprint, and clears old approval. Any recorded provider attempt, completed result or uncertain result retains its ledger and cannot be renewed into another attempt. Retain these records; do not clear them or assign new IDs to work around uncertainty. If the event cannot be reconciled, inspect its Google Calendar outcome personally.

The app supports timed, single events with at most 25 guests and a maximum seven-day duration. All-day events, recurrence and Meet creation are outside this creation form. Nonexistent and repeated daylight-saving wall times are rejected; choose an unambiguous time. Agenda reads support existing all-day events and preserve their calendar dates.

## OpenClaw draft handoff

OpenClaw can prepare untrusted draft details and supply an owner review link. It receives no calendar service credential or approval endpoint. Existing heartbeat OIDC and Second Brain credentials retain their existing scopes.

Use `buildCalendarDraftReviewLink` in `lib/calendar/event-contract.ts`, or form the equivalent URL with UTF-8 JSON encoded by `encodeURIComponent`:

```text
https://leadflow-review.web.app/dashboard/calendar#draft=<encoded-json>
```

Allowed optional draft fields are `summary`, `description`, `location`, `startLocal`, `endLocal`, `timeZone`, `attendees`, `sendUpdates`, `profileId` and `calendarId`. The UI does not use supplied profile/calendar fields to select an account: the owner chooses the verified connection. All unknown fields, including approval, receipt and derived timestamps, are rejected. JSON is limited to 16 KiB. Use fragments, not query parameters, for draft contents; treat the resulting link as private because browser history and anyone holding the link can read it.

The owner must choose **Use draft details** before form prefilling. Opening or accepting a handoff never prepares, approves, executes, or sends. This release provides the handoff contract and receiving UI; it does not reconfigure a remote OpenClaw gateway, send active-agent messages, or retry any previously blocked invitation.

## API and storage boundary

All Calendar routes require a Firebase token verified with revocation checking and active owner membership. Approval additionally checks the trusted application Origin, strict `{fingerprint, approved:true}` input, an allowed current sign-in provider, and `auth_time` after preparation and within five minutes. The execute/reconcile endpoints accept only the saved fingerprint; event content cannot be replaced at execution.

`calendar_event_requests` is server-only. Existing default-deny Firestore rules already deny direct client access; the explicit rule documents that boundary. The Hosting/SSR release does not require a separate rules deployment.

A Firestore transaction persists an execution claim before insertion. Transactions contain no provider calls. Stable IDs deduplicate by owner, verified Google subject, concrete calendar and normalized event content, independently of profile aliases and mutable labels/grants. A separate nonce-bearing fingerprint binds the full review and selected connection. Google event IDs supplement the ledger; they are not a claim of provider-level exactly-once delivery.

The former direct creation routes (`events?action=create`, `create-event`, and `schedule`) return authenticated 409 responses directing callers to review. Legacy schedule dry runs are retired too. Shared legacy create/update/delete and meeting helpers reject before provider calls, including calls from existing voice and lead-run workers. No automatic booking path is added; existing worker failure handling applies to retired operations. Event listing, availability and cleanup previews require explicit profile/calendar selection; cleanup deletion is disabled.

Only the new reviewed engine inserts events. Account defaults, OAuth bindings, scope grants, sender profiles and external approval policies are not changed by this feature.
