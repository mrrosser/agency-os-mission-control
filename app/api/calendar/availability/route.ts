import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { CalendarWorkProfileSchema } from "@/lib/calendar/event-contract";
import { calendarJson, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";
import { checkSelectedCalendarAvailability, resolveCalendarContext } from "@/lib/calendar/google-calendar-context";

const bodySchema = z.object({
  profileId: CalendarWorkProfileSchema,
  calendarId: z.string().min(1).max(1024).refine(
    (value) => !/\s|[\u0000-\u001f\u007f]/.test(value) && !["primary", ".", ".."].includes(value.toLowerCase()),
    "Select a concrete calendar ID.",
  ),
  startTime: z.string().max(64).datetime({ offset: true }),
  endTime: z.string().max(64).datetime({ offset: true }),
}).strict().refine((value) => {
  const duration = Date.parse(value.endTime) - Date.parse(value.startTime);
  return duration > 0 && duration <= 7 * 24 * 60 * 60_000;
}, "Choose a positive time range of no more than seven days.");

export const POST = withApiHandler(
  async ({ request, log }) => {
    const user = await requireCalendarOwner(request);
    const body = await parseCalendarJson(request, bodySchema);
    const context = await resolveCalendarContext(user.uid, body.profileId, log);
    const available = await checkSelectedCalendarAvailability(
      context, body.calendarId, body.startTime, body.endTime, log,
    );
    return calendarJson({ available });
  },
  { route: "calendar.availability" },
);