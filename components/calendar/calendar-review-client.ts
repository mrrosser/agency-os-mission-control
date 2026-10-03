import { z } from "zod";
import {
  CalendarEventDraftSchema, CalendarFingerprintSchema, CalendarRequestIdSchema, CalendarWorkProfileSchema,
  type CalendarChoicesResponse, type CalendarEventReview,
} from "@/lib/calendar/event-contract";

const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const choice = z.object({ id: z.string().min(1), summary: z.string(), timeZone: z.string(), accessRole: z.string(), primary: z.boolean(), canCreateEvents: z.boolean() });
const choices = z.object({ profileId: CalendarWorkProfileSchema, accountEmail: z.string().email(), identityVerified: z.literal(true), canWriteEvents: z.boolean(), calendars: z.array(choice) });
const review = z.object({
  requestId: CalendarRequestIdSchema, fingerprint: CalendarFingerprintSchema,
  status: z.enum(["awaiting_approval", "approved", "executing", "completed", "unknown", "blocked"]),
  createdAt: timestamp, expiresAt: timestamp, accountEmail: z.string().email(), calendar: choice,
  event: CalendarEventDraftSchema.safeExtend({ startDateTime: timestamp, endDateTime: timestamp }),
  availability: z.object({ available: z.boolean(), checkedAt: timestamp }), approvedAt: timestamp.nullable(),
  receipt: z.object({ eventId: z.string().min(1), htmlLink: z.string().nullable(), createdAt: timestamp, reconciled: z.boolean(), sendUpdates: z.enum(["all", "none"]) }).nullable(),
  error: z.string().nullable(),
}).refine((value) => value.event.calendarId === value.calendar.id, "Calendar identity mismatch");

export function parseCalendarChoices(value: unknown): CalendarChoicesResponse { return choices.parse(value); }
export function parseCalendarReview(value: unknown): CalendarEventReview { return review.parse(value); }

export function displayCalendarTime(value: string, timeZone: string): string {
  try { return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "full", timeStyle: "long" }).format(new Date(value)); }
  catch { return value; }
}

/** Date-only Google events are calendar dates, not UTC instants. */
export function displayCalendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

export function safeCalendarLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "calendar.google.com" || (url.hostname === "www.google.com" && url.pathname.startsWith("/calendar/"))) ? url.href : null;
  } catch { return null; }
}
