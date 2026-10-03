import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/handler";
import type { Logger } from "@/lib/logging";
import {
  resolveGoogleAccountTokens,
  type GoogleAccountTokenRecord,
} from "@/lib/google/account-token-store";
import { fetchGoogleAccountIdentity, getAccessTokenForUser } from "@/lib/google/oauth";
import type { CalendarEvent, CreateEventInput } from "@/lib/google/calendar";
import {
  CalendarWorkProfileSchema,
  type CalendarChoice,
  type CalendarWorkProfileId,
} from "@/lib/calendar/event-contract";

const API = "https://www.googleapis.com/calendar/v3";
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const FULL_SCOPE = "https://www.googleapis.com/auth/calendar";
const MAX_PAGES = 10;
const PAGE_SIZE = 250;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CHOICE_FIELDS = "id,summary,timeZone,accessRole,primary,deleted";
const ROLES = new Set(["freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"]);
const WRITER_ROLES = new Set(["writerWithoutPrivateAccess", "writer", "owner"]);

/** Server-only: never persist or serialize this object, because it contains a token. */
export interface CalendarContext {
  readonly accessToken: string;
  readonly profileId: CalendarWorkProfileId;
  readonly accountId: string;
  readonly accountEmail: string;
  readonly accountSubject: string;
  readonly bindingFingerprint: string;
  readonly canWriteEvents: boolean;
}

export type ReviewedCalendarEventPayload = Omit<CreateEventInput, "conferenceData"> & {
  id: string;
  extendedProperties?: { private?: Record<string, string> };
};

function scopeSet(value: string | null | undefined): string[] {
  return [...new Set(String(value || "").split(/\s+/).filter(Boolean))].sort();
}

function requireReadScope(scopes: string[]): void {
  if (!scopes.includes(READ_SCOPE) && !scopes.includes(FULL_SCOPE)) {
    throw new ApiError(403, "The selected work connection does not have calendar read permission.");
  }
}

async function boundRecord(uid: string, profileId: CalendarWorkProfileId): Promise<GoogleAccountTokenRecord> {
  let resolution;
  try { resolution = await resolveGoogleAccountTokens(uid, profileId); }
  catch { throw new ApiError(503, "The selected Google connection is unavailable."); }
  if (!resolution.registryFound || !resolution.profileMapped) {
    throw new ApiError(409, "The selected work profile is not connected.");
  }
  const record = resolution.record;
  if (!record?.tokens || !record.accountId || record.profileId !== profileId) {
    throw new ApiError(403, "The selected work connection is not usable.");
  }
  return record;
}

function assertStoredIdentity(record: GoogleAccountTokenRecord, identity: { email: string; subject: string }): void {
  const email = record.tokens?.accountEmail;
  const subject = record.tokens?.accountSubject;
  // Older work bindings may not store identity fields. Fresh verified userinfo
  // pins those records for this review without writing or replacing the binding.
  if ((email && email.trim().toLowerCase() !== identity.email) || (subject && subject.trim() !== identity.subject)) {
    throw new ApiError(409, "The selected Google account identity changed. Review the connection again.");
  }
}

export async function resolveCalendarContext(uid: string, profileId: string, log?: Logger): Promise<CalendarContext> {
  const selection = CalendarWorkProfileSchema.safeParse(profileId);
  if (!selection.success) throw new ApiError(400, "Select an existing calendar work profile.");
  if (!uid) throw new ApiError(401, "Authentication is required.");
  const before = await boundRecord(uid, selection.data);
  const beforeScopes = scopeSet(before.tokens?.scope);
  requireReadScope(beforeScopes);
  const accessToken = await getAccessTokenForUser(uid, log, { profileId: selection.data });
  const identity = await fetchGoogleAccountIdentity(accessToken, log);
  assertStoredIdentity(before, identity);
  const after = await boundRecord(uid, selection.data);
  const scopes = scopeSet(after.tokens?.scope);
  if (after.accountId !== before.accountId || JSON.stringify(scopes) !== JSON.stringify(beforeScopes)) {
    throw new ApiError(409, "The selected Google account binding changed. Review the connection again.");
  }
  assertStoredIdentity(after, identity);
  requireReadScope(scopes);
  const bindingFingerprint = `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    profileId: selection.data,
    accountId: after.accountId,
    email: identity.email,
    subject: identity.subject,
    scopes,
  })).digest("hex")}`;
  return Object.freeze({
    accessToken,
    profileId: selection.data,
    accountId: after.accountId,
    accountEmail: identity.email,
    accountSubject: identity.subject,
    bindingFingerprint,
    canWriteEvents: scopes.includes(WRITE_SCOPE) || scopes.includes(FULL_SCOPE),
  });
}

function concreteCalendarId(value: string): string {
  if (typeof value !== "string" || !value || value.length > 1024 || /\s|[\u0000-\u001f\u007f]/.test(value) || ["primary", ".", ".."].includes(value.toLowerCase())) {
    throw new ApiError(400, "Select a concrete verified calendar ID.");
  }
  return value;
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "Google Calendar returned an invalid response.");
  return value as Record<string, unknown>;
}

/** Preserve provider status; in particular, a network error must never become a missing event. */
async function calendarRequest(context: CalendarContext, path: string, init: RequestInit = {}, log?: Logger): Promise<unknown> {
  if (!CalendarWorkProfileSchema.safeParse(context.profileId).success || !context.accessToken) {
    throw new ApiError(403, "A verified work calendar context is required.");
  }
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${context.accessToken}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new ApiError(503, "Google Calendar did not return a response. The operation outcome may be unknown.", { providerStatus: null });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    log?.warn("calendar.provider.error", { status: response.status, method: init.method || "GET" });
    throw new ApiError(response.status >= 400 && response.status < 500 ? response.status : 502,
      `Google Calendar request failed (${response.status}).`, { providerStatus: response.status });
  }
  if (!response.body || Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, "Google Calendar returned an invalid response size.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new ApiError(502, "Google Calendar response is too large."); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "Google Calendar returned an incomplete or invalid response.");
  } finally { reader.releaseLock(); }
}

function choiceFromResponse(value: unknown, context: CalendarContext): CalendarChoice {
  const entry = object(value);
  if (entry.deleted === true || typeof entry.id !== "string" || typeof entry.summary !== "string" || !validTimeZone(entry.timeZone) || typeof entry.accessRole !== "string" || !ROLES.has(entry.accessRole)) {
    throw new ApiError(502, "Google Calendar returned incomplete calendar permissions or timezone metadata.");
  }
  let id: string;
  try { id = concreteCalendarId(entry.id); }
  catch { throw new ApiError(502, "Google Calendar returned an invalid calendar ID."); }
  return { id, summary: entry.summary, timeZone: entry.timeZone, accessRole: entry.accessRole, primary: entry.primary === true,
    canCreateEvents: context.canWriteEvents && WRITER_ROLES.has(entry.accessRole) };
}

export async function listCalendarChoices(context: CalendarContext, log?: Logger): Promise<CalendarChoice[]> {
  const choices: CalendarChoice[] = [];
  const seenIds = new Set<string>();
  const seenPages = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE), showDeleted: "false", fields: `nextPageToken,items(${CHOICE_FIELDS})` });
    if (pageToken) params.set("pageToken", pageToken);
    const response = object(await calendarRequest(context, `/users/me/calendarList?${params}`, {}, log));
    if (response.items !== undefined && !Array.isArray(response.items)) throw new ApiError(502, "Google Calendar returned an invalid calendar list.");
    for (const raw of (response.items || []) as unknown[]) {
      const choice = choiceFromResponse(raw, context);
      if (seenIds.has(choice.id) || choices.length >= MAX_PAGES * PAGE_SIZE) throw new ApiError(502, "Google Calendar returned an inconsistent calendar list.");
      choices.push(choice); seenIds.add(choice.id);
    }
    if (response.nextPageToken === undefined || response.nextPageToken === "") return choices;
    if (typeof response.nextPageToken !== "string" || response.nextPageToken.length > 4096 || seenPages.has(response.nextPageToken)) throw new ApiError(502, "Google Calendar pagination is invalid.");
    pageToken = response.nextPageToken; seenPages.add(pageToken);
  }
  throw new ApiError(502, "The calendar list exceeded the supported page limit; no partial selection was returned.");
}

export async function requireCalendarChoice(context: CalendarContext, calendarId: string, options: { write: boolean }, log?: Logger): Promise<CalendarChoice> {
  const id = concreteCalendarId(calendarId);
  if (options.write && !context.canWriteEvents) throw new ApiError(403, "The selected work connection cannot create calendar events.");
  const params = new URLSearchParams({ fields: CHOICE_FIELDS });
  const choice = choiceFromResponse(await calendarRequest(context, `/users/me/calendarList/${encodeURIComponent(id)}?${params}`, {}, log), context);
  if (choice.id !== id) throw new ApiError(409, "Google Calendar returned a different calendar than the one selected.");
  if (options.write && !choice.canCreateEvents) throw new ApiError(403, "The selected account cannot create events on this calendar.");
  return choice;
}

function instant(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ApiError(400, "Use a valid date and time with an explicit UTC offset.");
  }
  return Date.parse(value);
}

function eventResponse(value: unknown, allowUntitled = false): CalendarEvent {
  const event = object(value);
  // Calendar lists may contain legitimate untitled or restricted-detail events.
  // Reviewed writes and reconciliation still require the provider's exact title.
  const summary = allowUntitled && event.summary === undefined ? "" : event.summary;
  if (typeof event.id !== "string" || !event.id || typeof summary !== "string" || !event.start || typeof event.start !== "object" || !event.end || typeof event.end !== "object") {
    throw new ApiError(502, "Google Calendar returned incomplete event data.");
  }
  return { ...event, summary } as unknown as CalendarEvent;
}

export async function listSelectedCalendarEvents(context: CalendarContext, calendarId: string, options: { timeMin?: string; timeMax?: string; maxResults?: number }, log?: Logger): Promise<{ events: CalendarEvent[]; nextPageToken?: string }> {
  const maxResults = options.maxResults ?? 25;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw new ApiError(400, "Choose between 1 and 100 events.");
  const timeMin = options.timeMin || new Date().toISOString();
  const from = instant(timeMin);
  if (options.timeMax && instant(options.timeMax) <= from) throw new ApiError(400, "The end must be after the start.");
  await requireCalendarChoice(context, calendarId, { write: false }, log);
  const params = new URLSearchParams({ maxResults: String(maxResults), singleEvents: "true", orderBy: "startTime", timeMin });
  if (options.timeMax) params.set("timeMax", options.timeMax);
  const response = object(await calendarRequest(context, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {}, log));
  if (response.items !== undefined && !Array.isArray(response.items)) throw new ApiError(502, "Google Calendar returned an invalid event list.");
  if (response.nextPageToken !== undefined && typeof response.nextPageToken !== "string") throw new ApiError(502, "Google Calendar returned invalid event pagination.");
  return { events: ((response.items || []) as unknown[]).map((event) => eventResponse(event, true)), ...(typeof response.nextPageToken === "string" ? { nextPageToken: response.nextPageToken } : {}) };
}

export async function checkSelectedCalendarAvailability(context: CalendarContext, calendarId: string, startISO: string, endISO: string, log?: Logger): Promise<boolean> {
  if (instant(endISO) <= instant(startISO)) throw new ApiError(400, "The end must be after the start.");
  await requireCalendarChoice(context, calendarId, { write: false }, log);
  const response = object(await calendarRequest(context, "/freeBusy", { method: "POST", body: JSON.stringify({ timeMin: startISO, timeMax: endISO, items: [{ id: calendarId }] }) }, log));
  const calendars = object(response.calendars);
  const selected = object(calendars[calendarId]);
  if ((selected.errors !== undefined && (!Array.isArray(selected.errors) || selected.errors.length > 0)) || !Array.isArray(selected.busy)) {
    throw new ApiError(502, "Google could not verify this calendar's availability.");
  }
  for (const raw of selected.busy) {
    const range = object(raw);
    try { if (instant(range.end as string) <= instant(range.start as string)) throw new Error(); }
    catch { throw new ApiError(502, "Google Calendar returned invalid busy intervals."); }
  }
  return selected.busy.length === 0;
}

export async function getSelectedCalendarEvent(context: CalendarContext, calendarId: string, eventId: string, log?: Logger): Promise<CalendarEvent | null> {
  if (typeof eventId !== "string" || !eventId || eventId.length > 1024 || /[\u0000-\u001f\u007f]/.test(eventId) || [".", ".."].includes(eventId)) throw new ApiError(400, "A valid event ID is required.");
  await requireCalendarChoice(context, calendarId, { write: false }, log);
  try {
    const event = eventResponse(await calendarRequest(context, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {}, log));
    if (event.id !== eventId) throw new ApiError(502, "Google Calendar returned a different event ID.");
    return event;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.details?.providerStatus === 404) return null;
    throw error;
  }
}

export async function insertReviewedCalendarEvent(context: CalendarContext, calendarId: string, eventPayload: ReviewedCalendarEventPayload, sendUpdates: "all" | "none", log?: Logger): Promise<CalendarEvent> {
  if (!eventPayload || typeof eventPayload.id !== "string" || !/^[0-9a-v]{5,1024}$/.test(eventPayload.id)) throw new ApiError(400, "A deterministic Google event ID is required.");
  if ("conferenceData" in eventPayload) throw new ApiError(400, "Conference creation is not part of this reviewed event workflow.");
  if (!["all", "none"].includes(sendUpdates)) throw new ApiError(400, "An explicit notification choice is required.");
  if ((Boolean(eventPayload.attendees?.length)) !== (sendUpdates === "all")) throw new ApiError(400, "Events with guests require the reviewed invitation choice.");
  if (!validTimeZone(eventPayload.start?.timeZone) || eventPayload.start.timeZone !== eventPayload.end?.timeZone) throw new ApiError(400, "A matching explicit event timezone is required.");
  if (instant(eventPayload.end.dateTime || "") <= instant(eventPayload.start.dateTime || "")) throw new ApiError(400, "The end must be after the start.");
  await requireCalendarChoice(context, calendarId, { write: true }, log);
  const params = new URLSearchParams({ sendUpdates });
  const event = eventResponse(await calendarRequest(context, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`, { method: "POST", body: JSON.stringify(eventPayload) }, log));
  if (event.id !== eventPayload.id) throw new ApiError(502, "Google Calendar returned a different event ID. The operation outcome is unknown.");
  return event;
}
