import { z } from "zod";

export const CALENDAR_WORK_PROFILES = [
  { profileId: "rosser_gallery_work", label: "Rosser Gallery" },
  { profileId: "rt_solutions_work", label: "RT.Solutions" },
] as const;
export type CalendarWorkProfileId = (typeof CALENDAR_WORK_PROFILES)[number]["profileId"];
export const CalendarWorkProfileSchema = z.enum(["rosser_gallery_work", "rt_solutions_work"]);

export interface CalendarChoice {
  id: string;
  summary: string;
  timeZone: string;
  accessRole: string;
  primary: boolean;
  canCreateEvents: boolean;
}

export interface CalendarChoicesResponse {
  profileId: CalendarWorkProfileId;
  accountEmail: string;
  identityVerified: true;
  canWriteEvents: boolean;
  calendars: CalendarChoice[];
}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a local date and time including minutes.");
const calendarDraftFields = {
  profileId: CalendarWorkProfileSchema,
  calendarId: z.string().trim().min(1).max(1024).refine((value) => value !== "primary", "Select a verified calendar ID."),
  summary: z.string().trim().min(1).max(200),
  description: z.string().max(8000).default(""),
  location: z.string().trim().max(512).default(""),
  startLocal: localTime,
  endLocal: localTime,
  timeZone: z.string().trim().min(1).max(80),
  attendees: z.array(z.string().trim().email().max(254)).max(25).default([]),
  sendUpdates: z.enum(["all", "none"]),
};
export const CalendarEventDraftSchema = z.object(calendarDraftFields).strict().superRefine((value, ctx) => {
  if ((value.attendees.length > 0) !== (value.sendUpdates === "all")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sendUpdates"], message: "Events with guests must explicitly send invitations to all guests; events without guests use no notifications." });
  }
  if (/[\u0000-\u001f\u007f]/.test(value.summary) || /[\u0000\u007f]/.test(value.description + value.location)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "Remove control characters from the event details." });
  }
});
export type CalendarEventDraft = z.infer<typeof CalendarEventDraftSchema>;
export const CalendarDraftHandoffSchema = z.object({
  ...calendarDraftFields,
  description: z.string().max(8000),
  location: z.string().trim().max(512),
  attendees: z.array(z.string().trim().email().max(254)).max(25),
}).partial().strict();
export type CalendarDraftHandoff = z.infer<typeof CalendarDraftHandoffSchema>;

/** Draft handoffs carry no authorization and use a fragment to avoid server request logs. */
export function parseCalendarDraftHandoff(hash: string): CalendarDraftHandoff | null {
  if (!hash.startsWith("#draft=")) return null;
  if (hash.length > 49_200) throw new Error("The calendar draft handoff is too large.");
  try {
    const raw = decodeURIComponent(hash.slice(7));
    if (new TextEncoder().encode(raw).length > 16_384) throw new Error("too large");
    return CalendarDraftHandoffSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("This calendar draft handoff is invalid. Enter the event details manually.");
  }
}

export function buildCalendarDraftReviewLink(draft: CalendarDraftHandoff): string {
  const raw = JSON.stringify(CalendarDraftHandoffSchema.parse(draft));
  if (new TextEncoder().encode(raw).length > 16_384) throw new Error("The calendar draft handoff is too large.");
  return `https://leadflow-review.web.app/dashboard/calendar#draft=${encodeURIComponent(raw)}`;
}
export interface NormalizedCalendarEvent extends CalendarEventDraft {
  startDateTime: string;
  endDateTime: string;
}

export type CalendarEventRequestStatus = "awaiting_approval" | "approved" | "executing" | "completed" | "unknown" | "blocked";
export interface CalendarEventReceipt {
  eventId: string;
  htmlLink: string | null;
  createdAt: string;
  reconciled: boolean;
  sendUpdates: "all" | "none";
}
export interface CalendarEventReview {
  requestId: string;
  fingerprint: string;
  status: CalendarEventRequestStatus;
  createdAt: string;
  expiresAt: string;
  accountEmail: string;
  calendar: CalendarChoice;
  event: NormalizedCalendarEvent;
  availability: { available: boolean; checkedAt: string };
  approvedAt: string | null;
  receipt: CalendarEventReceipt | null;
  error: string | null;
}

export const CalendarRequestIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const CalendarFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const CalendarApprovalSchema = z.object({ fingerprint: CalendarFingerprintSchema, approved: z.literal(true) }).strict();
export const CalendarExecutionSchema = z.object({ fingerprint: CalendarFingerprintSchema }).strict();

function wallParts(epochMs: number, formatter: Intl.DateTimeFormat): number[] {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  return [Number(parts.year), Number(parts.month), Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)];
}

/** Resolve a wall time without assuming the browser/server timezone. Reject gaps and repeated times. */
export function resolveCalendarLocalTime(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Enter a complete local date and time.");
  const [year, month, day, hour, minute] = local.split(/[-T:]/).map(Number);
  if (year < 2000 || year > 2100) throw new Error("Choose a year between 2000 and 2100.");
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(guess).toISOString().slice(0, 16) !== local) throw new Error("Enter a valid calendar date and time.");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatter.format(new Date(guess));
  } catch {
    throw new Error("Choose a valid IANA timezone, such as America/Chicago.");
  }
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = guess + hours * 3_600_000;
    const [y, m, d, h, min, sec] = wallParts(sample, formatter);
    offsets.add(Date.UTC(y, m - 1, d, h, min, sec) - sample);
  }
  const expected = [year, month, day, hour, minute, 0];
  const candidates = [...offsets].map((offset) => guess - offset).filter((epoch) => wallParts(epoch, formatter).every((part, index) => part === expected[index]));
  if (candidates.length === 0) throw new Error("This local time does not exist because of a timezone clock change. Choose another time.");
  if (candidates.length !== 1) throw new Error("This local time occurs twice because of a timezone clock change. Choose an unambiguous time.");
  return new Date(candidates[0]).toISOString();
}

export function normalizeCalendarEventDraft(input: CalendarEventDraft, now: number = Date.now()): NormalizedCalendarEvent {
  const parsed = CalendarEventDraftSchema.parse(input);
  const startDateTime = resolveCalendarLocalTime(parsed.startLocal, parsed.timeZone);
  const endDateTime = resolveCalendarLocalTime(parsed.endLocal, parsed.timeZone);
  const start = Date.parse(startDateTime);
  const end = Date.parse(endDateTime);
  if (start <= now) throw new Error("The event must start in the future.");
  if (end <= start) throw new Error("The end must be after the start.");
  if (end - start > 7 * 86_400_000) throw new Error("An event can last at most seven days.");
  return {
    ...parsed,
    description: parsed.description.replace(/\r\n?/g, "\n").trim(),
    attendees: [...new Set(parsed.attendees.map((email) => email.toLowerCase()))].sort(),
    startDateTime,
    endDateTime,
  };
}
