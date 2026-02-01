import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listEvents, createEvent, CreateEventInput } from "@/lib/google/calendar";

const getQuerySchema = z.object({
  maxResults: z.number().int().min(1).max(100).optional(),
  timeMin: z.string().optional(),
});

const createEventSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  location: z.string().optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
  })).optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);

    if (action === "list") {
      const body = await parseJson(request, getQuerySchema);
      const result = await listEvents(
        accessToken,
        body.maxResults || 10,
        body.timeMin,
        log
      );
      return NextResponse.json(result);
    }

    if (action === "create") {
      const body = await parseJson(request, createEventSchema);
      const result = await createEvent(accessToken, body as CreateEventInput, log);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  },
  { route: "calendar.events" }
);
