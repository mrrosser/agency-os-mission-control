import { ApiError, withApiHandler } from "@/lib/api/handler";
import { CalendarApprovalSchema, CalendarRequestIdSchema } from "@/lib/calendar/event-contract";
import { approveCalendarEventRequest } from "@/lib/calendar/event-requests";
import { assertCalendarApprovalOrigin, calendarJson, parseCalendarJson, requireCalendarOwner } from "@/lib/calendar/request-auth";

export const dynamic = "force-dynamic";
export const POST = withApiHandler(async ({ request, params, log }) => {
  assertCalendarApprovalOrigin(request);
  const user = await requireCalendarOwner(request);
  const id = CalendarRequestIdSchema.safeParse(params?.requestId);
  if (!id.success || new URL(request.url).search) throw new ApiError(400, "Invalid calendar request ID.");
  const body = await parseCalendarJson(request, CalendarApprovalSchema, 1024);
  return calendarJson({ request: await approveCalendarEventRequest(user.uid, id.data, body, { authTime: user.auth_time, provider: user.firebase.sign_in_provider }, log) });
}, { route: "calendar.requests.approve", persistServerErrors: false });
