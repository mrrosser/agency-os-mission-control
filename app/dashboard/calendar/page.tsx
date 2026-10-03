"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders } from "@/lib/api/client";
import type { CalendarEvent } from "@/lib/google/calendar";
import { CALENDAR_WORK_PROFILES, CalendarRequestIdSchema, parseCalendarDraftHandoff, type CalendarDraftHandoff, type CalendarChoicesResponse, type CalendarWorkProfileId } from "@/lib/calendar/event-contract";
import { MeetingScheduler } from "@/components/calendar/MeetingScheduler";
import { displayCalendarDate, displayCalendarTime, parseCalendarChoices } from "@/components/calendar/calendar-review-client";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Clock, MapPin, Plus, RefreshCw } from "lucide-react";

export default function CalendarPage() {
  const { user } = useAuth();
  const [profileId, setProfileId] = useState<CalendarWorkProfileId | "">("");
  const [choices, setChoices] = useState<CalendarChoicesResponse | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [locked, setLocked] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [offeredDraft, setOfferedDraft] = useState<CalendarDraftHandoff | null>(null);
  const [acceptedDraft, setAcceptedDraft] = useState<CalendarDraftHandoff | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [pageOwner, setPageOwner] = useState<string | null>(null);
  const lastOwner = useRef<string | null>(null);
  const agendaGeneration = useRef(0);
  const ownerReady = Boolean(user && pageOwner === user.uid);
  const calendar = ownerReady ? choices?.calendars.find((item) => item.id === calendarId) || null : null;

  useEffect(() => {
    const nextOwner = user?.uid || null;
    if (lastOwner.current === nextOwner) return;
    const previousOwner = lastOwner.current;
    lastOwner.current = nextOwner;
    setPageOwner(nextOwner);
    setProfileId(""); setCalendarId(""); setChoices(null); setEvents([]); setLastError(null);
    setShowScheduler(false); setRequestId(null); setLocked(false);
    if (previousOwner !== null) { setOfferedDraft(null); setAcceptedDraft(null); }
    const savedRequest = new URLSearchParams(window.location.search).get("request");
    if (savedRequest !== null) {
      setLocked(true);
      if (CalendarRequestIdSchema.safeParse(savedRequest).success) { setRequestId(savedRequest); setShowScheduler(true); }
      else setLastError("Invalid saved calendar request ID. No calendar request has been loaded.");
    }
  }, [user?.uid]);

  useEffect(() => {
    const savedRequest = new URLSearchParams(window.location.search).get("request");
    if (savedRequest !== null) {
      setLocked(true);
      if (!CalendarRequestIdSchema.safeParse(savedRequest).success) setLastError("Invalid saved calendar request ID. No calendar request has been loaded.");
      else { setRequestId(savedRequest); setShowScheduler(true); }
    } else {
      try { setOfferedDraft(parseCalendarDraftHandoff(window.location.hash)); }
      catch (error) { setLastError(error instanceof Error ? error.message : "Invalid calendar draft handoff."); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setChoices(null); setCalendarId(""); setEvents([]);
    if (!user || pageOwner !== user.uid || !profileId) { setLoadingChoices(false); return () => controller.abort(); }
    setLoadingChoices(true); setLastError(null);
    void (async () => {
      try {
        const headers = await buildAuthHeaders(user);
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/calendar/calendars?profileId=${encodeURIComponent(profileId)}`, { headers, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Could not verify calendars (${response.status}).`);
        const verified = parseCalendarChoices(data);
        if (verified.profileId !== profileId) throw new Error("The calendar service returned a different work profile.");
        if (!controller.signal.aborted) setChoices(verified);
      } catch (error) {
        if (!controller.signal.aborted) setLastError(error instanceof Error && error.name !== "ZodError" ? error.message : "Could not verify this work account and its calendars.");
      } finally { if (!controller.signal.aborted) setLoadingChoices(false); }
    })();
    return () => controller.abort();
  }, [user, pageOwner, profileId]);

  useEffect(() => {
    const controller = new AbortController();
    const stamp = ++agendaGeneration.current;
    setEvents([]);
    if (!user || pageOwner !== user.uid || !profileId || !calendarId || !calendar) { setLoadingEvents(false); return () => controller.abort(); }
    setLoadingEvents(true); setLastError(null);
    void (async () => {
      try {
        const headers = await buildAuthHeaders(user);
        if (controller.signal.aborted) return;
        const response = await fetch("/api/calendar/events?action=list", { method: "POST", headers, signal: controller.signal,
          body: JSON.stringify({ profileId, calendarId, maxResults: 20 }) });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Could not load events (${response.status}).`);
        if (!Array.isArray(data.events)) throw new Error("The calendar service returned an invalid agenda.");
        if (!controller.signal.aborted && stamp === agendaGeneration.current) setEvents(data.events);
      } catch (error) { if (!controller.signal.aborted) setLastError(error instanceof Error ? error.message : "Could not load this calendar."); }
      finally { if (!controller.signal.aborted) setLoadingEvents(false); }
    })();
    return () => controller.abort();
  }, [user, pageOwner, profileId, calendarId, calendar, refresh]);

  const completed = useCallback(() => setRefresh((value) => value + 1), []);
  const canCreate = Boolean(ownerReady && choices?.canWriteEvents && calendar?.canCreateEvents);

  return <div className="min-h-screen bg-black p-6 md:p-8 text-zinc-100">
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><AfroGlyph variant="calendar" className="h-8 w-8 text-blue-500" /><h1 className="text-3xl font-bold">Calendar</h1></div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setRefresh((value) => value + 1)} disabled={loadingEvents || !calendar} aria-label="Refresh calendar"><RefreshCw className={`h-4 w-4 ${loadingEvents ? "animate-spin" : ""}`} /></Button>
          <Button onClick={() => setShowScheduler(true)} disabled={!canCreate || locked || showScheduler}><Plus className="h-4 w-4 mr-2" />Create Event</Button>
        </div>
      </div>
      {ownerReady && offeredDraft && <section aria-label="Draft handoff" className="space-y-3 rounded-lg border border-amber-900 bg-zinc-950 p-4">
        <h2 className="font-semibold">Event draft received</h2>
        <p className="text-sm text-zinc-400">These are unverified draft details. Using them only fills the form. Choose the work account and calendar yourself, then review every detail before approval.</p>
        {offeredDraft.summary && <p>{offeredDraft.summary}</p>}
        <Button disabled={locked} onClick={() => {
          setAcceptedDraft(offeredDraft); setOfferedDraft(null);
          const url = new URL(window.location.href); url.hash = ""; window.history.replaceState(window.history.state, "", url);
        }}>Use draft details</Button>
      </section>}
      <section aria-label="Select a verified calendar" className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <p className="text-sm text-zinc-400">Choose a work profile and calendar. This does not change your default account or connect another account.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="calendar-profile">Google work profile</Label><select id="calendar-profile" value={ownerReady ? profileId : ""} disabled={locked || !ownerReady} onChange={(event) => {
            agendaGeneration.current += 1; setProfileId(event.target.value as CalendarWorkProfileId | ""); setChoices(null); setCalendarId(""); setEvents([]); setShowScheduler(false);
          }} className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-white">
            <option value="">Choose a work profile</option>{CALENDAR_WORK_PROFILES.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.label}</option>)}
          </select></div>
          <div><Label htmlFor="calendar-choice">Calendar</Label><select id="calendar-choice" value={ownerReady ? calendarId : ""} disabled={locked || !ownerReady || !choices || loadingChoices} onChange={(event) => {
            agendaGeneration.current += 1; setCalendarId(event.target.value); setEvents([]); setShowScheduler(false);
          }} className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-white">
            <option value="">Choose a calendar</option>{ownerReady && choices?.calendars.map((item) => <option key={item.id} value={item.id}>{item.summary}{item.primary ? " (primary)" : ""}{!item.canCreateEvents ? " (read only)" : ""}</option>)}
          </select></div>
        </div>
        {loadingChoices && <p role="status">Verifying work account and calendars…</p>}
        {ownerReady && choices && <p className="text-sm">Verified account: <strong>{choices.accountEmail}</strong>{!choices.canWriteEvents ? ". This connection cannot create events." : ""}</p>}
        {calendar && <p className="text-sm text-zinc-400 break-all">Calendar ID: {calendar.id} · Timezone: {calendar.timeZone} · Access: {calendar.accessRole}</p>}
        {calendar && !canCreate && <p>This calendar is available for viewing only. Event creation requires a writable calendar and a connection with event permission.</p>}
        {locked && <p className="text-sm text-zinc-400">The saved review identifies its own account and calendar. Selection is locked while that request is open.</p>}
      </section>
      {ownerReady && lastError && <div role="alert" className="rounded border border-red-900 bg-red-950/30 p-3 text-red-200">{lastError}<p className="mt-2"><Link className="underline" href="/dashboard/integrations">Review Google connections</Link></p></div>}
      {ownerReady && showScheduler && <MeetingScheduler key={`${user?.uid}:${requestId || `${profileId}:${calendarId}:${acceptedDraft ? "handoff" : "manual"}`}`} profileId={profileId} calendar={calendar}
        accountEmail={choices?.accountEmail || ""} canWriteEvents={Boolean(choices?.canWriteEvents)} requestId={requestId} draft={acceptedDraft} onLockChange={setLocked} onCompleted={completed} />}
      <section aria-label="Upcoming events" className="space-y-3">
        <h2 className="text-xl font-semibold">Upcoming events{calendar ? ` · ${calendar.timeZone}` : ""}</h2>
        {!calendar ? <p className="text-zinc-400">Select a verified calendar to view its agenda.</p> : loadingEvents ? <p role="status">Loading events…</p> : events.length === 0 ? <p className="text-zinc-400">No upcoming events.</p> : events.map((event) => <article key={event.id} className="p-4 border border-zinc-800 rounded-lg bg-zinc-950">
          <h3 className="text-lg font-semibold">{event.summary || "(No title)"}</h3>
          {event.description && <p className="text-sm text-zinc-400 whitespace-pre-wrap line-clamp-2">{event.description}</p>}
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-400">
            <p className="flex items-center gap-2"><Clock className="h-4 w-4" />{event.start.dateTime ? displayCalendarTime(event.start.dateTime, calendar.timeZone) : event.start.date ? `${displayCalendarDate(event.start.date)} · All day` : "Time unavailable"}</p>
            {event.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{event.location}</p>}
          </div>
        </article>)}
      </section>
    </div>
  </div>;
}
