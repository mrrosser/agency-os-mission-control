import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listUpcomingEvents } from "@/lib/google/calendar";
import { dbAdmin } from "@/lib/db-admin";

const bodySchema = z.object({
  maxResults: z.number().int().min(1).max(250).optional(),
  calendarId: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);

    const events = await listUpcomingEvents(
      accessToken,
      body.maxResults || 10,
      body.calendarId || "primary",
      log
    );

    await dbAdmin.logActivity({
      userId: user.uid,
      action: "Calendar checked",
      details: `${events.length} events found`,
      type: "calendar"
    });

    return NextResponse.json({ events });
  },
  { route: "calendar.events" }
);
