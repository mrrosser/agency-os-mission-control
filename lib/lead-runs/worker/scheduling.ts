import "server-only";

import { ApiError } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import { pickFirstAvailableStart, type BusyRange } from "@/lib/calendar/availability";
import { buildCandidateMeetingSlotsInTimeZone } from "@/lib/calendar/slot-search";
import { createMeetingWithAvailabilityCheck, listBusyIntervals } from "@/lib/google/calendar";
import type { LeadRunJobConfig } from "@/lib/lead-runs/jobs";
import { buildLeadActionIdempotencyKey } from "@/lib/lead-runs/ids";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";
import type { Logger } from "@/lib/logging";

export interface LeadDocForScheduling {
  companyName?: string;
  founderName?: string;
}

export interface ScheduleAttemptResult {
  kind: "scheduled" | "no_slot";
  scheduledStart?: string;
  scheduledEnd?: string;
  meetLink?: string;
  eventId?: string;
  htmlLink?: string;
  replayed?: boolean;
  checkedCandidates?: number;
  busyCount?: number;
  windowsTried?: number;
}

function toBusyRanges(intervals: Array<{ start: string; end: string }>): BusyRange[] {
  return intervals
    .map((range) => ({ start: new Date(range.start), end: new Date(range.end) }))
    .filter((range) => !Number.isNaN(range.start.valueOf()) && !Number.isNaN(range.end.valueOf()));
}

export function availabilityDraftHtml(leadName: string, founderName: string, businessName: string): string {
  return `
    <h2>Hi ${leadName},</h2>
    <p>I tried to find a quick 30-minute slot on my calendar, but didn’t see a clean opening this week.</p>
    <p>Could you reply with 2-3 times that work for you next week? I’ll send an invite immediately.</p>
    <br/>
    <p>Best regards,</p>
    <p>${founderName}<br/>${businessName}</p>
  `;
}

export async function runScheduleAttempt(
  args: {
    accessToken: string;
    config: LeadRunJobConfig;
    runId: string;
    leadDocId: string;
    lead: LeadDocForScheduling;
    leadEmail?: string;
    correlationId: string;
    uid: string;
    retryAttempt: number;
  },
  log: Logger
): Promise<ScheduleAttemptResult> {
  const durationMinutes = 30;
  const retryShift = Math.max(0, args.retryAttempt - 1);
  const slotSearches = [
    {
      timeZone: args.config.timeZone,
      leadTimeDays: Math.max(0, 2 - retryShift),
      slotMinutes: 30,
      businessStartHour: 9,
      businessEndHour: 17,
      searchDays: 7 + retryShift * 3,
      maxSlots: 40,
      anchorHour: 14 + retryShift,
    },
    {
      timeZone: args.config.timeZone,
      leadTimeDays: Math.max(0, 2 - retryShift),
      slotMinutes: 30,
      businessStartHour: 8,
      businessEndHour: 18,
      searchDays: 14 + retryShift * 4,
      maxSlots: 100,
      anchorHour: 13 + retryShift,
    },
    {
      timeZone: args.config.timeZone,
      leadTimeDays: 0,
      slotMinutes: 30,
      businessStartHour: 8,
      businessEndHour: 20,
      searchDays: 21 + retryShift * 4,
      maxSlots: 160,
      anchorHour: 11,
      includeWeekends: true,
    },
  ];

  let windowsTried = 0;
  let checkedCandidates = 0;
  let maxBusyCount = 0;

  for (const slotSearch of slotSearches) {
    windowsTried += 1;
    const candidatesRaw = buildCandidateMeetingSlotsInTimeZone(slotSearch);
    const rotateBy = candidatesRaw.length > 0 ? (args.retryAttempt - 1) % candidatesRaw.length : 0;
    const candidates =
      rotateBy > 0
        ? [...candidatesRaw.slice(rotateBy), ...candidatesRaw.slice(0, rotateBy)]
        : candidatesRaw;
    if (candidates.length === 0) continue;

    if (args.config.dryRun) {
      const start = candidates[0]!;
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "calendar.booking",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "simulated",
          dryRun: true,
          replayed: false,
          idempotencyKey: buildLeadActionIdempotencyKey({
            runId: args.runId,
            leadDocId: args.leadDocId,
            action: "calendar.schedule",
          }),
          data: {
            scheduledStart: start.toISOString(),
            scheduledEnd: end.toISOString(),
            timeZone: slotSearch.timeZone,
          },
        },
        log
      );
      return {
        kind: "scheduled",
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      };
    }

    try {
      const idempotencyKey = buildLeadActionIdempotencyKey({
        runId: args.runId,
        leadDocId: args.leadDocId,
        action: "calendar.schedule",
      });

      const result = await withIdempotency(
        { uid: args.uid, route: "calendar.schedule", key: idempotencyKey, log },
        async () => {
          const calendarId = "primary";
          const durationMs = durationMinutes * 60 * 1000;
          const timeMin = candidates[0]!;
          const timeMax = new Date(candidates[candidates.length - 1]!.getTime() + durationMs);
          const busyIntervals = await listBusyIntervals(
            args.accessToken,
            timeMin,
            timeMax,
            calendarId,
            log
          );
          const busyRanges = toBusyRanges(busyIntervals);

          for (const start of candidates) {
            const picked = pickFirstAvailableStart([start], durationMinutes, busyRanges);
            if (!picked) continue;

            const created = await createMeetingWithAvailabilityCheck(
              args.accessToken,
              {
                summary: `Discovery Call - ${args.lead.companyName || "Lead"}`,
                description: `Call with ${args.lead.founderName || "there"} from ${args.lead.companyName || "lead"}`,
                attendees: args.leadEmail ? [{ email: args.leadEmail }] : [],
                start: { dateTime: picked.start.toISOString() },
                end: { dateTime: picked.end.toISOString() },
                conferenceData: {
                  createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                  },
                },
              },
              calendarId,
              log
            );

            if (created.success && created.event) {
              const meetLink =
                created.event.conferenceData?.entryPoints?.find((entry) => entry.uri)?.uri || undefined;
              return {
                scheduledStart: picked.start.toISOString(),
                scheduledEnd: picked.end.toISOString(),
                event: created.event,
                meetLink,
              };
            }
          }

          throw new ApiError(409, "No available slot found", {
            checked: candidates.length,
            busyCount: busyRanges.length,
          });
        }
      );

      await recordLeadActionReceipt(
        {
          runId: args.runId,
          leadDocId: args.leadDocId,
          actionId: "calendar.booking",
          uid: args.uid,
          correlationId: args.correlationId,
          status: "complete",
          dryRun: false,
          replayed: result.replayed,
          idempotencyKey,
          data: {
            scheduledStart: result.data.scheduledStart,
            scheduledEnd: result.data.scheduledEnd,
            eventId: result.data.event?.id,
            htmlLink: result.data.event?.htmlLink,
            meetLink: result.data.meetLink,
          },
        },
        log
      );

      return {
        kind: "scheduled",
        scheduledStart: result.data.scheduledStart,
        scheduledEnd: result.data.scheduledEnd,
        eventId: result.data.event?.id,
        htmlLink: result.data.event?.htmlLink,
        meetLink: result.data.meetLink,
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const checked =
          typeof error.details?.checked === "number" ? error.details.checked : candidates.length;
        const busyCount =
          typeof error.details?.busyCount === "number" ? error.details.busyCount : 0;
        checkedCandidates += checked;
        if (busyCount > maxBusyCount) {
          maxBusyCount = busyCount;
        }
        continue;
      }
      throw error;
    }
  }

  return {
    kind: "no_slot",
    checkedCandidates,
    busyCount: maxBusyCount,
    windowsTried,
  };
}
