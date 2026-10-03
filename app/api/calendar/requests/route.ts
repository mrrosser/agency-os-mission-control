import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarEventDraftSchema } from "@/lib/calendar/event-contract";
import { prepareCalendarEventRequest } from "@/lib/calendar/event-requests";
import { calendarJson, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

export const dynamic = "force-dynamic";
export const POST = withApiHandler(async ({ request, log }) => {
  const user = await requireCalendarOwner(request);
  if (new URL(request.url).search) throw new ApiError(400, "Calendar preparation does not accept query parameters.");
  const input = await parseCalendarJson(request, CalendarEventDraftSchema);
  return calendarJson({ request: await prepareCalendarEventRequest(user.uid, input, log) });
}, { route: "calendar.requests.prepare", persistServerErrors: false });
