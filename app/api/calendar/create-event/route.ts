import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireCalendarOwner } from "@/lib/calendar/request-auth";

// The legacy route cannot express a reviewed account, calendar, time and
// invitation fingerprint. All creation now goes through the approval workflow.
export const POST = withApiHandler(
  async ({ request }) => {
    await requireCalendarOwner(request);
    throw new ApiError(409, "Review the exact event in /dashboard/calendar before creating it.");
  },
  { route: "calendar.create-event" },
);