import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarRequestIdSchema } from "@/lib/calendar/event-contract";
import { getCalendarEventRequest } from "@/lib/calendar/event-requests";
import { calendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

export const dynamic = "force-dynamic";
export const GET = withApiHandler(async ({ request, params }) => {
  const user = await requireCalendarOwner(request);
  const id = CalendarRequestIdSchema.safeParse(params?.requestId);
  if (!id.success || new URL(request.url).search) throw new ApiError(400, "Invalid calendar request ID.");
  return calendarJson({ request: await getCalendarEventRequest(user.uid, id.data) });
}, { route: "calendar.requests.read", persistServerErrors: false });
