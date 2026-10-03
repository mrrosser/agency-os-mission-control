import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireCalendarOwner } from "@/lib/calendar/request-auth";

// Retire both execution and simulated booking receipts from the old automatic
// slot picker. A calendar action must review one exact event before approval.
export const POST = withApiHandler(
  async ({ request }) => {
    await requireCalendarOwner(request);
    throw new ApiError(409, "Review the exact event in /dashboard/calendar before creating it.");
  },
  { route: "calendar.schedule" },
);