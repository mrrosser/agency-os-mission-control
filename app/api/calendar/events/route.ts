import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { listEvents, createEvent, deleteEvent, CreateEventInput } from "@/lib/google/calendar";

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

const cleanupEventsSchema = z.object({
  summaryPrefix: z.string().min(1).max(120).optional(),
  timeMin: z.string().optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log, { requireCapability: "calendar" });

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

    if (action === "cleanup") {
      const body = await parseJson(request, cleanupEventsSchema);
      const summaryPrefix = body.summaryPrefix || "Discovery Call -";
      const dryRun = body.dryRun !== false;
      const maxResults = body.maxResults || 100;
      const listed = await listEvents(accessToken, maxResults, body.timeMin, log);
      const matchingEvents = listed.events.filter((event) =>
        String(event.summary || "").startsWith(summaryPrefix)
      );

      const deletedEventIds: string[] = [];
      const failed: Array<{ eventId: string; error: string }> = [];
      if (!dryRun) {
        for (const event of matchingEvents) {
          if (!event.id) continue;
          try {
            await deleteEvent(accessToken, event.id, log);
            deletedEventIds.push(event.id);
          } catch (error) {
            failed.push({
              eventId: event.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      return NextResponse.json({
        ok: true,
        dryRun,
        summaryPrefix,
        scanned: listed.events.length,
        matched: matchingEvents.length,
        deleted: deletedEventIds.length,
        deletedEventIds,
        failed,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  },
  { route: "calendar.events" }
);
