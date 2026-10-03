import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarWorkProfileSchema } from "@/lib/calendar/event-contract";
import { calendarJson, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";
import { listSelectedCalendarEvents, resolveCalendarContext } from "@/lib/calendar/google-calendar-context";

const concreteCalendarId = z.string().min(1).max(1024).refine(
  (value) => !/\s|[\u0000-\u001f\u007f]/.test(value) && !["primary", ".", ".."].includes(value.toLowerCase()),
  "Select a concrete calendar ID.",
);
const listSchema = z.object({
  profileId: CalendarWorkProfileSchema,
  calendarId: concreteCalendarId,
  maxResults: z.number().int().min(1).max(100).optional(),
  timeMin: z.string().max(64).datetime({ offset: true }).optional(),
}).strict();
const cleanupSchema = listSchema.extend({
  summaryPrefix: z.string().min(1).max(120).optional(),
  dryRun: z.boolean().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const user = await requireCalendarOwner(request);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "create") {
      throw new ApiError(409, "Review the exact event in /dashboard/calendar before creating it.");
    }
    if (action === "list") {
      const body = await parseCalendarJson(request, listSchema);
      const context = await resolveCalendarContext(user.uid, body.profileId, log);
      // The selected-calendar helper verifies the concrete calendar and its ACL.
      return calendarJson(await listSelectedCalendarEvents(context, body.calendarId, {
        maxResults: body.maxResults ?? 10,
        timeMin: body.timeMin,
      }, log));
    }
    if (action === "cleanup") {
      const body = await parseCalendarJson(request, cleanupSchema);
      if (body.dryRun === false) {
        throw new ApiError(409, "Direct calendar deletion is disabled. Review the exact event in /dashboard/calendar.");
      }
      const context = await resolveCalendarContext(user.uid, body.profileId, log);
      const listed = await listSelectedCalendarEvents(context, body.calendarId, {
        maxResults: body.maxResults ?? 100,
        timeMin: body.timeMin,
      }, log);
      const summaryPrefix = body.summaryPrefix ?? "Discovery Call -";
      const matchingEvents = listed.events.filter((event) => event.summary.startsWith(summaryPrefix));
      return calendarJson({
        ok: true,
        dryRun: true,
        summaryPrefix,
        scanned: listed.events.length,
        matched: matchingEvents.length,
        deleted: 0,
        deletedEventIds: [],
        failed: [],
        truncated: Boolean(listed.nextPageToken),
        ...(listed.nextPageToken ? { nextPageToken: listed.nextPageToken } : {}),
      });
    }
    throw new ApiError(400, "Invalid calendar action.");
  },
  { route: "calendar.events" },
);