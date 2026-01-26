import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createMeetingWithAvailabilityCheck } from "@/lib/google/calendar";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const eventSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  start: z.object({
    dateTime: z.string(),
    timeZone: z.string().optional(),
  }),
  end: z.object({
    dateTime: z.string(),
    timeZone: z.string().optional(),
  }),
  attendees: z
    .array(
      z.object({
        email: z.string().email(),
        displayName: z.string().optional(),
      })
    )
    .optional(),
  location: z.string().optional(),
  conferenceData: z.any().optional(),
});

const bodySchema = z.object({
  event: eventSchema,
  calendarId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "calendar.create-event", key: idempotencyKey, log },
      () =>
        createMeetingWithAvailabilityCheck(
          accessToken,
          body.event,
          body.calendarId || "primary",
          log
        )
    );

    if (!result.data.success) {
      throw new ApiError(409, result.data.error || "Calendar conflict");
    }

    return NextResponse.json({
      success: true,
      event: result.data.event,
      replayed: result.replayed,
    });
  },
  { route: "calendar.create-event" }
);
