import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarWorkProfileSchema } from "@/lib/calendar/event-contract";
import { listCalendarChoices, resolveCalendarContext } from "@/lib/calendar/google-calendar-context";
import { calendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

export const dynamic = "force-dynamic";
export const GET = withApiHandler(async ({ request, log }) => {
  const user = await requireCalendarOwner(request);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "profileId") || query.getAll("profileId").length !== 1) throw new ApiError(400, "Select one existing work profile.");
  const parsed = CalendarWorkProfileSchema.safeParse(query.get("profileId"));
  if (!parsed.success) throw new ApiError(400, "Select an existing Gallery or RT.Solutions work profile.");
  const context = await resolveCalendarContext(user.uid, parsed.data, log);
  const calendars = await listCalendarChoices(context, log);
  return calendarJson({ profileId: context.profileId, accountEmail: context.accountEmail, identityVerified: true, canWriteEvents: context.canWriteEvents, calendars });
}, { route: "calendar.calendars", persistServerErrors: false });
