"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EmailAuthProvider, GoogleAuthProvider, OAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, type IdTokenResult } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders } from "@/lib/api/client";
import { CALENDAR_WORK_PROFILES, CalendarRequestIdSchema, buildCalendarDraftReviewLink, normalizeCalendarEventDraft,
  type CalendarChoice, type CalendarDraftHandoff, type CalendarEventDraft, type CalendarEventReview, type CalendarWorkProfileId } from "@/lib/calendar/event-contract";
import { displayCalendarTime, parseCalendarReview, safeCalendarLink } from "./calendar-review-client";

interface MeetingSchedulerProps {
  profileId: CalendarWorkProfileId | "";
  calendar: CalendarChoice | null;
  accountEmail: string;
  canWriteEvents: boolean;
  requestId?: string | null;
  draft?: CalendarDraftHandoff | null;
  onLockChange: (locked: boolean) => void;
  onCompleted: () => void;
}

const fieldClass = "bg-zinc-900 border border-zinc-700 rounded-md text-white w-full p-2";
const allowedProviders = new Set(["google.com", "password", "apple.com"]);

function freshIdentity(token: IdTokenResult, createdAt: string): boolean {
  const authenticatedAt = Number(token.claims.auth_time);
  const now = Date.now() / 1000;
  return allowedProviders.has(token.signInProvider || "") && token.claims.email_verified === true &&
    Number.isFinite(authenticatedAt) && authenticatedAt >= Math.ceil(Date.parse(createdAt) / 1000) &&
    authenticatedAt <= now + 5 && now - authenticatedAt < 300;
}

function saveRequestLocation(requestId: string | null) {
  const url = new URL(window.location.href);
  if (requestId) url.searchParams.set("request", requestId);
  else url.searchParams.delete("request");
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}

export function MeetingScheduler({ profileId, calendar, accountEmail, canWriteEvents, requestId, draft, onLockChange, onCompleted }: MeetingSchedulerProps) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(draft?.summary || "");
  const [description, setDescription] = useState(draft?.description || "");
  const [location, setLocation] = useState(draft?.location || "");
  const [startLocal, setStartLocal] = useState(draft?.startLocal || "");
  const [endLocal, setEndLocal] = useState(draft?.endLocal || "");
  const [timeZone, setTimeZone] = useState(draft?.timeZone || calendar?.timeZone || "America/Chicago");
  const [guests, setGuests] = useState(draft?.attendees?.join(", ") || "");
  const [review, setReview] = useState<CalendarEventReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [verifiedAt, setVerifiedAt] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [now, setNow] = useState(Date.now());
  const operation = useRef(false);
  const generation = useRef(0);
  const currentReview = useRef<CalendarEventReview | null>(null);
  const userId = useRef(user?.uid);
  userId.current = user?.uid;
  currentReview.current = review;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setProvider(null); setVerifiedAt(null); setConsent(false); setPassword("");
    if (user) void user.getIdTokenResult().then((token) => {
      if (generation.current === current) setProvider(token.signInProvider);
    }).catch(() => {
      if (generation.current === current) setError("Could not verify your sign-in method. Sign in again before approving.");
    });
    return () => { generation.current += 1; };
  }, [user]);

  async function readRequestResponse(response: Response, expected?: CalendarEventReview) {
    let data: { request?: unknown; error?: string };
    try { data = await response.json(); } catch { throw new Error("The calendar service returned an unreadable response."); }
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Calendar request failed (${response.status}).`);
    let result: CalendarEventReview;
    try { result = parseCalendarReview(data.request); } catch { throw new Error("The calendar service returned an invalid review. Check the saved request before continuing."); }
    if (expected && (result.requestId !== expected.requestId || result.fingerprint !== expected.fingerprint)) throw new Error("The saved review changed. Reload this request before continuing.");
    return result;
  }

  useEffect(() => {
    if (!requestId || !user) return;
    const controller = new AbortController();
    const owner = user.uid;
    onLockChange(true); setBusy(true); operation.current = true;
    void (async () => {
      try {
        if (!CalendarRequestIdSchema.safeParse(requestId).success) throw new Error("Invalid saved calendar request ID.");
        const headers = await buildAuthHeaders(user);
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/calendar/requests/${requestId}`, { headers, signal: controller.signal });
        const result = await readRequestResponse(response);
        if (result.requestId !== requestId) throw new Error("The calendar service returned a different request.");
        if (!controller.signal.aborted && userId.current === owner) { setReview(result); setError(null); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not recover the saved request.");
      } finally {
        if (!controller.signal.aborted) { setBusy(false); operation.current = false; }
      }
    })();
    return () => controller.abort();
  }, [requestId, user, onLockChange]);

  function acceptReview(result: CalendarEventReview) {
    setReview(result); setConsent(false); setVerifiedAt(null);
    saveRequestLocation(result.requestId); onLockChange(true);
    if (result.status === "completed") { setUncertain(false); onCompleted(); }
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (operation.current || !user || !profileId || !calendar || !canWriteEvents || !calendar.canCreateEvents || review || requestId) return;
    setError(null);
    let draft: CalendarEventDraft;
    try {
      const attendees = guests.split(/[,;\n]/).map((email) => email.trim()).filter(Boolean);
      const normalized = normalizeCalendarEventDraft({ profileId, calendarId: calendar.id, summary, description, location, startLocal,
        endLocal, timeZone, attendees, sendUpdates: attendees.length ? "all" : "none" });
      draft = { profileId: normalized.profileId, calendarId: normalized.calendarId, summary: normalized.summary,
        description: normalized.description, location: normalized.location, startLocal: normalized.startLocal,
        endLocal: normalized.endLocal, timeZone: normalized.timeZone, attendees: normalized.attendees, sendUpdates: normalized.sendUpdates };
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== "ZodError" ? failure.message : "Check the title, dates, timezone and guest email addresses (maximum 25)."); return;
    }
    operation.current = true; setBusy(true); onLockChange(true);
    const stamp = generation.current;
    const owner = user.uid;
    try {
      const headers = await buildAuthHeaders(user);
      if (generation.current !== stamp || userId.current !== owner) return;
      const response = await fetch("/api/calendar/requests", { method: "POST", headers, body: JSON.stringify(draft) });
      const result = await readRequestResponse(response);
      if (generation.current !== stamp || userId.current !== owner) return;
      if (result.event.profileId !== profileId || result.calendar.id !== calendar.id || result.accountEmail.toLowerCase() !== accountEmail.toLowerCase()) throw new Error("The selected calendar identity changed. Refresh the calendar selection and prepare a new review.");
      acceptReview(result);
    } catch (failure) {
      if (generation.current === stamp) { setError(failure instanceof Error ? failure.message : "Could not prepare the event review."); onLockChange(false); }
    } finally {
      if (generation.current === stamp) { operation.current = false; setBusy(false); }
    }
  }

  async function verifyIdentity() {
    if (operation.current || !user || !review || review.status !== "awaiting_approval") return;
    operation.current = true; setBusy(true); setError(null); setConsent(false); setVerifiedAt(null);
    const secret = password; setPassword("");
    const owner = user.uid;
    const expected = review;
    const stamp = generation.current;
    try {
      const currentToken = await user.getIdTokenResult();
      const signInProvider = currentToken.signInProvider; setProvider(signInProvider);
      if (!allowedProviders.has(signInProvider || "") || user.isAnonymous) throw new Error("This sign-in method cannot approve calendar events here. Sign in yourself with a supported verified Google, Apple or password account.");
      // Firebase auth_time is whole seconds; require the new sign-in after preparation.
      if (Date.now() < Math.ceil(Date.parse(expected.createdAt) / 1000) * 1000) throw new Error("Please wait one second after preparing the review, then verify your identity.");
      if (signInProvider === "password") {
        if (!user.email || !secret) throw new Error("Enter your current password to verify your identity.");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, secret));
      } else {
        const identityProvider = signInProvider === "google.com" ? new GoogleAuthProvider() : new OAuthProvider("apple.com");
        await reauthenticateWithPopup(user, identityProvider);
      }
      const refreshed = await user.getIdTokenResult(true);
      if (generation.current !== stamp || userId.current !== owner || currentReview.current?.fingerprint !== expected.fingerprint) return;
      if (!freshIdentity(refreshed, expected.createdAt)) throw new Error("A fresh sign-in with a verified email is required after this review was prepared. Verify your identity again.");
      setProvider(refreshed.signInProvider); setVerifiedAt(Number(refreshed.claims.auth_time) * 1000);
    } catch (failure) {
      if (generation.current === stamp) {
        const code = typeof failure === "object" && failure !== null && "code" in failure ? String(failure.code) : "";
        setError(code.startsWith("auth/") ? "Identity verification did not complete. Check your sign-in and try again; no event was created." : failure instanceof Error ? failure.message : "Identity verification did not complete.");
      }
    } finally { if (generation.current === stamp) { operation.current = false; setBusy(false); } }
  }

  async function approveAndExecute() {
    if (operation.current || !user || !review || !consent || uncertain || !["awaiting_approval", "approved"].includes(review.status)) return;
    const expected = review;
    const owner = user.uid;
    const stamp = generation.current;
    operation.current = true; setBusy(true); setError(null); setConsent(false);
    let mutationStarted = false;
    try {
      if (Date.now() >= Date.parse(expected.expiresAt)) throw new Error("This review expired. It can no longer create an event.");
      if (expected.status === "awaiting_approval") {
        const token = await user.getIdTokenResult();
        if (!verifiedAt || !freshIdentity(token, expected.createdAt)) { setVerifiedAt(null); throw new Error("Verify your identity again before approving this event."); }
      }
      const headers = await buildAuthHeaders(user);
      if (generation.current !== stamp || userId.current !== owner || currentReview.current?.fingerprint !== expected.fingerprint) return;
      if (expected.status === "awaiting_approval") {
        mutationStarted = true;
        const response = await fetch(`/api/calendar/requests/${expected.requestId}/approve`, { method: "POST", headers, body: JSON.stringify({ fingerprint: expected.fingerprint, approved: true }) });
        const approved = await readRequestResponse(response, expected);
        if (generation.current !== stamp || userId.current !== owner) return;
        setReview(approved);
        if (approved.status !== "approved") { acceptReview(approved); return; }
      }
      mutationStarted = true;
      const response = await fetch(`/api/calendar/requests/${expected.requestId}/execute`, { method: "POST", headers, body: JSON.stringify({ fingerprint: expected.fingerprint }) });
      const result = await readRequestResponse(response, expected);
      if (generation.current === stamp && userId.current === owner) acceptReview(result);
    } catch (failure) {
      if (generation.current === stamp) {
        if (mutationStarted) setUncertain(true);
        setError(mutationStarted ? "The outcome has not been confirmed. Check this saved request or reconcile its status before taking any further action." : failure instanceof Error ? failure.message : "Could not approve the event.");
      }
    } finally { if (generation.current === stamp) { operation.current = false; setBusy(false); } }
  }

  async function refreshRequest(reconcile: boolean) {
    if (operation.current || !user || !review) return;
    const expected = review;
    const stamp = generation.current;
    const owner = user.uid;
    operation.current = true; setBusy(true); setError(null);
    try {
      const headers = await buildAuthHeaders(user);
      if (generation.current !== stamp || userId.current !== owner) return;
      const response = await fetch(`/api/calendar/requests/${expected.requestId}${reconcile ? "/reconcile" : ""}`, {
        method: reconcile ? "POST" : "GET", headers, ...(reconcile ? { body: JSON.stringify({ fingerprint: expected.fingerprint }) } : {}),
      });
      const result = await readRequestResponse(response, expected);
      if (generation.current === stamp && userId.current === owner) {
        if (!reconcile && ["awaiting_approval", "approved"].includes(result.status)) setUncertain(false);
        acceptReview(result);
      }
    } catch (failure) { if (generation.current === stamp) setError(failure instanceof Error ? failure.message : "Could not check the saved request."); }
    finally { if (generation.current === stamp) { operation.current = false; setBusy(false); } }
  }

  const expired = review ? now >= Date.parse(review.expiresAt) : false;
  const verified = verifiedAt !== null && now - verifiedAt < 300_000;
  const recoveryOnly = uncertain || review?.status === "unknown" || review?.status === "executing";
  const mayApprove = review?.status === "awaiting_approval" && !recoveryOnly && !expired;
  const mayExecuteApproved = review?.status === "approved" && !recoveryOnly && !expired;
  const canVerify = provider !== null && allowedProviders.has(provider);
  const receiptLink = safeCalendarLink(review?.receipt?.htmlLink || null);
  let reviseLink: string | null = null;
  if (review && !recoveryOnly && ["awaiting_approval", "blocked"].includes(review.status)) {
    const event = review.event;
    try {
      const link = new URL(buildCalendarDraftReviewLink({ profileId: event.profileId, calendarId: event.calendarId,
        summary: event.summary, description: event.description, location: event.location, startLocal: event.startLocal,
        endLocal: event.endLocal, timeZone: event.timeZone, attendees: event.attendees, sendUpdates: event.sendUpdates }));
      reviseLink = `${link.pathname}${link.hash}`;
    } catch {
      // A valid stored event can exceed the smaller URL-handoff byte limit.
    }
  }

  return <Card className="bg-zinc-950 border-zinc-800 text-zinc-100">
    <CardHeader><CardTitle>{review ? "Review event" : requestId ? "Recover saved event request" : "Create Event"}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      {error && <p role="alert" className="rounded border border-red-900 bg-red-950/30 p-3 text-red-200">{error}</p>}
      {busy && <p role="status" aria-live="polite">Working…</p>}
      {!review && requestId && !busy && <p>Reload this page to check the same saved request. No new event request will be created.</p>}
      {!review && !requestId && <form onSubmit={prepare} className="space-y-4">
        <p className="text-sm text-zinc-400">Prepare a review for {accountEmail} on {calendar?.summary}. Preparation does not create an event or send invitations.</p>
        <div><Label htmlFor="event-title">Title</Label><Input id="event-title" required maxLength={200} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={busy} className={fieldClass} /></div>
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="event-start">Start</Label><Input id="event-start" type="datetime-local" required value={startLocal} onChange={(e) => setStartLocal(e.target.value)} disabled={busy} className={fieldClass} /></div>
          <div><Label htmlFor="event-end">End</Label><Input id="event-end" type="datetime-local" required value={endLocal} onChange={(e) => setEndLocal(e.target.value)} disabled={busy} className={fieldClass} /></div>
        </div>
        <div><Label htmlFor="event-timezone">Timezone</Label><Input id="event-timezone" required maxLength={80} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} disabled={busy} className={fieldClass} /><p className="text-sm text-zinc-400">IANA timezone, such as America/Chicago. Times above use this timezone.</p></div>
        <div><Label htmlFor="event-guests">Guests</Label><textarea id="event-guests" value={guests} onChange={(e) => setGuests(e.target.value)} disabled={busy} className={fieldClass} rows={2} /><p className="text-sm text-zinc-400">Separate up to 25 email addresses with commas or newlines. Guests will receive invitations when you approve and create the event. With no guests, no notifications are sent.</p></div>
        <div><Label htmlFor="event-location">Location</Label><Input id="event-location" maxLength={512} value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} className={fieldClass} /></div>
        <div><Label htmlFor="event-description">Description</Label><textarea id="event-description" maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} className={fieldClass} rows={4} /></div>
        <Button type="submit" disabled={busy || !profileId || !calendar?.canCreateEvents || !canWriteEvents}>Prepare review</Button>
      </form>}
      {review && <section aria-label="Review event" data-testid="calendar-event-review" className="space-y-4">
        <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-[10rem_1fr]">
          <dt className="text-zinc-400">Status</dt><dd>{review.status}</dd>
          <dt className="text-zinc-400">Work profile</dt><dd>{CALENDAR_WORK_PROFILES.find((item) => item.profileId === review.event.profileId)?.label} ({review.event.profileId})</dd>
          <dt className="text-zinc-400">Verified account</dt><dd>{review.accountEmail}</dd>
          <dt className="text-zinc-400">Calendar</dt><dd className="break-all">{review.calendar.summary} — {review.calendar.id}</dd>
          <dt className="text-zinc-400">Calendar access</dt><dd>{review.calendar.accessRole}; {review.calendar.primary ? "primary" : "additional"}; event creation {review.calendar.canCreateEvents ? "allowed" : "unavailable"}; calendar timezone {review.calendar.timeZone}</dd>
          <dt className="text-zinc-400">Title</dt><dd>{review.event.summary}</dd>
          <dt className="text-zinc-400">Start</dt><dd>{displayCalendarTime(review.event.startDateTime, review.event.timeZone)}<br />{review.event.startLocal} ({review.event.timeZone})<br /><span className="text-zinc-400">{review.event.startDateTime}</span></dd>
          <dt className="text-zinc-400">End</dt><dd>{displayCalendarTime(review.event.endDateTime, review.event.timeZone)}<br />{review.event.endLocal} ({review.event.timeZone})<br /><span className="text-zinc-400">{review.event.endDateTime}</span></dd>
          <dt className="text-zinc-400">Guests</dt><dd>{review.event.attendees.length ? <ul>{review.event.attendees.map((email) => <li key={email}>{email}</li>)}</ul> : "None"}</dd>
          <dt className="text-zinc-400">Notifications</dt><dd>{review.event.sendUpdates === "all" ? "Send invitations to all listed guests" : "No notifications"} (sendUpdates: {review.event.sendUpdates})</dd>
          <dt className="text-zinc-400">Location</dt><dd className="whitespace-pre-wrap">{review.event.location || "None"}</dd>
          <dt className="text-zinc-400">Description</dt><dd className="whitespace-pre-wrap">{review.event.description || "None"}</dd>
          <dt className="text-zinc-400">Availability</dt><dd>{review.availability.available ? "Available when checked" : "Conflict detected"}; checked {displayCalendarTime(review.availability.checkedAt, review.event.timeZone)}. Availability can change.</dd>
          <dt className="text-zinc-400">Prepared</dt><dd>{displayCalendarTime(review.createdAt, review.event.timeZone)}</dd>
          <dt className="text-zinc-400">Review expires</dt><dd>{displayCalendarTime(review.expiresAt, review.event.timeZone)}</dd>
          {review.approvedAt && <><dt className="text-zinc-400">Approved</dt><dd>{displayCalendarTime(review.approvedAt, review.event.timeZone)}</dd></>}
        </dl>
        <details className="text-xs text-zinc-400"><summary>Saved request reference</summary><p className="break-all">Request: {review.requestId}</p><p className="break-all">Fingerprint: {review.fingerprint}</p></details>
        {review.error && <p role="alert" className="text-amber-200">{review.error}</p>}
        {expired && review.status !== "completed" && <p>This review has expired. It cannot be approved or executed.</p>}
        {recoveryOnly && <p role="status">The event outcome is not confirmed. Check or reconcile this saved request. These controls do not create another event or resend invitations.</p>}
        {review.status === "blocked" && <p>Creation is blocked. No further creation attempt is available for this request.</p>}
        {mayApprove && <div className="space-y-3 rounded border border-zinc-700 p-4">
          <h3 className="font-semibold">Verify your identity</h3>
          <p className="text-sm text-zinc-400">Verify the app sign-in for {user?.email || "your signed-in account"} after preparing this review, then approve the exact details above. Verification alone does not create an event.</p>
          {provider === "password" && <div><Label htmlFor="calendar-password">Current password</Label><Input id="calendar-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className={fieldClass} /></div>}
          {provider !== null && !canVerify && <p role="alert">This sign-in method cannot approve calendar events here. Sign in yourself with a supported verified Google, Apple or password account. Your saved review remains available at this URL.</p>}
          <Button type="button" variant="outline" onClick={verifyIdentity} disabled={busy || !canVerify || (provider === "password" && !password)}>Verify your identity</Button>
          {verified && <p role="status">Identity verified for this review. Approval is still required.</p>}
          {verifiedAt !== null && !verified && <p>Identity verification expired. Verify again before approving.</p>}
        </div>}
        {(mayExecuteApproved || mayApprove) && <div className="space-y-3 rounded border border-blue-800 p-4">
          <label className="flex items-start gap-3"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || (mayApprove && !verified)} className="mt-1" /><span>I approve creating this exact event and sending the listed invitations.</span></label>
          <Button type="button" onClick={approveAndExecute} disabled={busy || !consent || (mayApprove && !verified)}>{mayExecuteApproved ? "Create approved event" : "Approve and create event"}</Button>
        </div>}
        {review.receipt && <div role="status" className="space-y-2 rounded border border-green-800 p-4">
          <h3 className="font-semibold">Event created</h3><p className="break-all">Event ID: {review.receipt.eventId}</p>
          <p>Recorded {displayCalendarTime(review.receipt.createdAt, review.event.timeZone)}; {review.receipt.reconciled ? "confirmed by reconciliation" : "confirmed by creation response"}.</p>
          <p>{review.receipt.sendUpdates === "all" ? "Google accepted the event with invitations requested for all guests. Delivery is not confirmed." : "No guest notifications requested."}</p>
          {receiptLink && <a href={receiptLink} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">Open event in Google Calendar</a>}
        </div>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => refreshRequest(false)} disabled={busy}>Check request status</Button>
          {recoveryOnly && <Button type="button" variant="outline" onClick={() => refreshRequest(true)} disabled={busy}>Reconcile event status</Button>}
          {reviseLink && !busy && <a href={reviseLink} className="self-center text-blue-300 underline">Revise event details</a>}
        </div>
      </section>}
    </CardContent>
  </Card>;
}
