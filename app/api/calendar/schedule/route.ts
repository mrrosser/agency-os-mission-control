import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createMeetingWithAvailabilityCheck, listBusyIntervals } from "@/lib/google/calendar";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { pickFirstAvailableStart, type BusyRange } from "@/lib/calendar/availability";
import { buildCandidateMeetingSlotsInTimeZone } from "@/lib/calendar/slot-search";
import { sanitizeLogPayload } from "@/lib/api/guardrails";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";

const eventSchema = z.object({
  summary: z.string().min(1).max(120),
  description: z.string().max(8000).optional(),
  attendees: z
    .array(
      z.object({
        email: z.string().email(),
        displayName: z.string().optional(),
      })
    )
    .optional(),
  location: z.string().max(512).optional(),
  conferenceData: z.any().optional(),
});

const slotSearchSchema = z.object({
  timeZone: z.string().min(1).max(80),
  leadTimeDays: z.number().int().min(0).max(30).optional(),
  slotMinutes: z.number().int().min(10).max(120).optional(),
  businessStartHour: z.number().int().min(0).max(23).optional(),
  businessEndHour: z.number().int().min(1).max(24).optional(),
  searchDays: z.number().int().min(1).max(45).optional(),
  maxSlots: z.number().int().min(1).max(300).optional(),
  anchorHour: z.number().int().min(0).max(23).optional(),
  // For deterministic tests only; omitted in production callers.
  nowIso: z.string().datetime().optional(),
});

const bodySchema = z.object({
  event: eventSchema,
  candidateStarts: z.array(z.string().min(1)).min(1).max(300).optional(),
  slotSearch: slotSearchSchema.optional(),
  durationMinutes: z.number().int().min(10).max(120).optional(),
  calendarId: z.string().optional(),
  dryRun: z.boolean().optional(),
  idempotencyKey: z.string().optional(),
  runId: z.string().min(1).max(128).optional(),
  leadDocId: z.string().min(1).max(120).optional(),
  receiptActionId: z.string().min(1).max(120).optional(),
}).superRefine((value, ctx) => {
  if (!value.candidateStarts && !value.slotSearch) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either candidateStarts or slotSearch.",
      path: ["candidateStarts"],
    });
  }
});

function parseCandidateStarts(raw: string[]): Date[] {
  const unique = new Map<string, Date>();
  for (const value of raw) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) continue;
    unique.set(date.toISOString(), date);
  }

  return Array.from(unique.values()).sort((a, b) => a.getTime() - b.getTime());
}

function toBusyRanges(intervals: Array<{ start: string; end: string }>): BusyRange[] {
  return intervals
    .map((range) => ({ start: new Date(range.start), end: new Date(range.end) }))
    .filter((range) => !Number.isNaN(range.start.valueOf()) && !Number.isNaN(range.end.valueOf()));
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const durationMinutes = body.durationMinutes ?? 30;

    const candidates = body.candidateStarts
      ? parseCandidateStarts(body.candidateStarts)
      : buildCandidateMeetingSlotsInTimeZone({
          timeZone: body.slotSearch?.timeZone || "UTC",
          leadTimeDays: body.slotSearch?.leadTimeDays,
          slotMinutes: body.slotSearch?.slotMinutes,
          businessStartHour: body.slotSearch?.businessStartHour,
          businessEndHour: body.slotSearch?.businessEndHour,
          searchDays: body.slotSearch?.searchDays,
          maxSlots: body.slotSearch?.maxSlots,
          anchorHour: body.slotSearch?.anchorHour,
          now: body.slotSearch?.nowIso ? new Date(body.slotSearch.nowIso) : undefined,
        });

    if (candidates.length === 0) {
      throw new ApiError(400, "No valid calendar slot candidates provided.");
    }

    log.info(
      "calendar.schedule.request",
      sanitizeLogPayload({
        durationMinutes,
        candidateCount: candidates.length,
        slotSearch: body.slotSearch
          ? {
              timeZone: body.slotSearch.timeZone,
              leadTimeDays: body.slotSearch.leadTimeDays,
              slotMinutes: body.slotSearch.slotMinutes,
              businessStartHour: body.slotSearch.businessStartHour,
              businessEndHour: body.slotSearch.businessEndHour,
              searchDays: body.slotSearch.searchDays,
            }
          : undefined,
        calendarId: body.calendarId || "primary",
        dryRun: Boolean(body.dryRun),
        correlationId,
        idempotency: Boolean(idempotencyKey),
      })
    );

    if (body.dryRun) {
      const start = candidates[0]!;
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const payload = {
        success: true,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        event: {
          id: `dryrun_${correlationId.slice(0, 8)}`,
          summary: body.event.summary,
          description: body.event.description,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          attendees: body.event.attendees,
          location: body.event.location,
          htmlLink: undefined,
        },
        dryRun: true,
        replayed: false,
        checked: 1,
      };

      if (body.runId && body.leadDocId) {
        await recordLeadActionReceipt(
          {
            runId: body.runId,
            leadDocId: body.leadDocId,
            actionId: body.receiptActionId || "calendar.schedule",
            uid: user.uid,
            correlationId,
            status: "simulated",
            dryRun: true,
            replayed: false,
            idempotencyKey,
            data: {
              scheduledStart: payload.scheduledStart,
              scheduledEnd: payload.scheduledEnd,
              eventId: payload.event.id,
            },
          },
          log
        );
      }

      return NextResponse.json(payload);
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "calendar.schedule", key: idempotencyKey, log },
      async () => {
        const calendarId = body.calendarId || "primary";
        const durationMs = durationMinutes * 60 * 1000;
        const timeMin = candidates[0]!;
        const timeMax = new Date(candidates[candidates.length - 1]!.getTime() + durationMs);

        const busyIntervals = await listBusyIntervals(accessToken, timeMin, timeMax, calendarId, log);
        const busyRanges = toBusyRanges(busyIntervals);

        // Iterate candidates; only attempt creation for slots not overlapping known busy ranges.
        let checked = 0;
        for (const start of candidates) {
          checked += 1;

          const picked = pickFirstAvailableStart([start], durationMinutes, busyRanges);
          if (!picked) continue;

          const createResult = await createMeetingWithAvailabilityCheck(
            accessToken,
            {
              ...body.event,
              start: { dateTime: picked.start.toISOString() },
              end: { dateTime: picked.end.toISOString() },
            },
            calendarId,
            log
          );

          if (createResult.success && createResult.event) {
            const meetLink =
              createResult.event.conferenceData?.entryPoints?.find((p) => p.uri)?.uri || undefined;
            return {
              scheduledStart: picked.start.toISOString(),
              scheduledEnd: picked.end.toISOString(),
              event: createResult.event,
              meetLink,
              checked,
              busyCount: busyRanges.length,
            };
          }
        }

        throw new ApiError(409, "No available slot found.", {
          checked: candidates.length,
          busyCount: busyRanges.length,
        });
      }
    );

    const responsePayload = {
      success: true,
      scheduledStart: result.data.scheduledStart,
      scheduledEnd: result.data.scheduledEnd,
      event: result.data.event,
      meetLink: result.data.meetLink,
      checked: result.data.checked,
      busyCount: result.data.busyCount,
      replayed: result.replayed,
    };

    if (body.runId && body.leadDocId) {
      await recordLeadActionReceipt(
        {
          runId: body.runId,
          leadDocId: body.leadDocId,
          actionId: body.receiptActionId || "calendar.schedule",
          uid: user.uid,
          correlationId,
          status: "complete",
          dryRun: false,
          replayed: result.replayed,
          idempotencyKey,
          data: {
            scheduledStart: responsePayload.scheduledStart,
            scheduledEnd: responsePayload.scheduledEnd,
            eventId: responsePayload.event?.id,
            htmlLink: responsePayload.event?.htmlLink,
            meetLink: responsePayload.meetLink,
          },
        },
        log
      );
    }

    return NextResponse.json(responsePayload);
  },
  { route: "calendar.schedule" }
);
