import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarExecutionSchema, CalendarRequestIdSchema } from "@/lib/calendar/event-contract";
import { executeCalendarEventRequest } from "@/lib/calendar/event-requests";
import { calendarJson, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

export const dynamic = "force-dynamic";
export const POST = withApiHandler(async ({ request, params, log }) => {
  const user = await requireCalendarOwner(request);
  const id = CalendarRequestIdSchema.safeParse(params?.requestId);
  if (!id.success || new URL(request.url).search) throw new ApiError(400, "Invalid calendar request ID.");
  const body = await parseCalendarJson(request, CalendarExecutionSchema, 1024);
  return calendarJson({ request: await executeCalendarEventRequest(user.uid, id.data, body.fingerprint, log) });
}, { route: "calendar.requests.execute", persistServerErrors: false });
