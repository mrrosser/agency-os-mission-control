import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { checkAvailability } from "@/lib/google/calendar";

const bodySchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  calendarId: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      throw new ApiError(400, "Invalid startTime or endTime");
    }

    const isAvailable = await checkAvailability(
      accessToken,
      start,
      end,
      body.calendarId || "primary",
      log
    );

    return NextResponse.json({ available: isAvailable });
  },
  { route: "calendar.availability" }
);
