import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createDraftEmail } from "@/lib/google/gmail";
import { createMeetingWithAvailabilityCheck } from "@/lib/google/calendar";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { findDncMatch } from "@/lib/outreach/dnc";
import { withIdempotency } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/handler";
import type { VoiceActionName, VoiceKnowledgeContext } from "@/lib/voice/inbound-webhook";

export interface VoiceActionWorkerResult {
  scanned: number;
  claimed: number;
  completed: number;
  needsInput: number;
  failed: number;
  dryRun: boolean;
}

interface VoiceActionRequestDoc {
  requestId: string;
  status: string;
  action: VoiceActionName;
  mode?: string;
  callSid?: string;
  from?: string;
  to?: string;
  uid?: string | null;
  businessId?: string | null;
  transcript?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface ProcessVoiceActionInput {
  request: VoiceActionRequestDoc;
  context: VoiceKnowledgeContext;
  log: Logger;
  dryRun: boolean;
}

const DEFAULT_TIMEZONE = process.env.VOICE_ACTIONS_DEFAULT_TIMEZONE || "America/Chicago";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function firstEmail(text: string): string | null {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!matches || matches.length === 0) return null;
  return normalizeEmail(matches[0]);
}

function parseMeridiemHour(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const lower = meridiem.toLowerCase();
  if (lower === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
  const existing = dateTimeFormatters.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  dateTimeFormatters.set(timeZone, formatter);
  return formatter;
}

function normalizeTimeZone(timeZone: string | undefined): string {
  const candidate = (timeZone || "UTC").trim();
  if (!candidate) return "UTC";
  try {
    formatterForTimeZone(candidate).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function asTimeZoneParts(date: Date, timeZone: string): (LocalDateTimeParts & { second: number }) | null {
  const formatter = formatterForTimeZone(timeZone);
  const parts = formatter.formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      const parsed = Number(part.value);
      if (Number.isFinite(parsed)) values[part.type] = parsed;
    }
  }

  if (
    !values.year ||
    !values.month ||
    !values.day ||
    values.hour === undefined ||
    values.minute === undefined ||
    values.second === undefined
  ) {
    return null;
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localDateTimeFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): LocalDateTimeParts | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

function zonedLocalToUtc(parts: LocalDateTimeParts, timeZone: string): Date | null {
  const targetLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let guess = targetLocalMs;

  for (let i = 0; i < 5; i += 1) {
    const zoned = asTimeZoneParts(new Date(guess), timeZone);
    if (!zoned) return null;
    const zonedLocalMs = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      0
    );
    const delta = targetLocalMs - zonedLocalMs;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  const result = new Date(guess);
  const verify = asTimeZoneParts(result, timeZone);
  if (!verify) return null;
  if (
    verify.year !== parts.year ||
    verify.month !== parts.month ||
    verify.day !== parts.day ||
    verify.hour !== parts.hour ||
    verify.minute !== parts.minute
  ) {
    return null;
  }
  return result;
}

function tomorrowInTimeZone(now: Date, timeZone: string): { year: number; month: number; day: number } | null {
  const parts = asTimeZoneParts(now, timeZone);
  if (!parts) return null;
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0) + 24 * 60 * 60 * 1000;
  const tomorrow = new Date(midnightUtc);
  return {
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
  };
}

function parseRequestedLocalParts(
  transcript: string,
  now: Date,
  timeZone: string
): LocalDateTimeParts | null {
  const text = transcript.trim();
  if (!text) return null;

  const iso = text.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const rawHour = iso[4] ? Number(iso[4]) : 10;
    const hour = parseMeridiemHour(rawHour, iso[6]);
    const minute = iso[5] ? Number(iso[5]) : 0;
    const parsed = localDateTimeFromParts(year, month, day, hour, minute);
    if (parsed) return parsed;
  }

  const us = text.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    const rawHour = us[4] ? Number(us[4]) : 10;
    const hour = parseMeridiemHour(rawHour, us[6]);
    const minute = us[5] ? Number(us[5]) : 0;
    const parsed = localDateTimeFromParts(year, month, day, hour, minute);
    if (parsed) return parsed;
  }

  if (/tomorrow/i.test(text)) {
    const time = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const rawHour = time ? Number(time[1]) : 10;
    const hour = parseMeridiemHour(rawHour, time?.[3]);
    const minute = time?.[2] ? Number(time[2]) : 0;
    const tomorrow = tomorrowInTimeZone(now, timeZone);
    if (!tomorrow) return null;
    const parsed = localDateTimeFromParts(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute);
    if (parsed) return parsed;
  }

  return null;
}

export function parseRequestedStart(
  transcript: string,
  nowOrOptions: Date | { now?: Date; timeZone?: string } = new Date()
): Date | null {
  const now = nowOrOptions instanceof Date ? nowOrOptions : nowOrOptions.now || new Date();
  const timeZone = normalizeTimeZone(
    nowOrOptions instanceof Date ? "UTC" : nowOrOptions.timeZone || "UTC"
  );
  const local = parseRequestedLocalParts(transcript, now, timeZone);
  if (!local) return null;
  return zonedLocalToUtc(local, timeZone);
}

function voiceHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function actionIdempotencyKey(requestId: string, action: VoiceActionName, lane: "gmail" | "calendar"): string {
  return `voice-action:${requestId}:${action}:${lane}`;
}

function businessProfile(context: VoiceKnowledgeContext, businessId: string | null | undefined) {
  if (!businessId) return null;
  return context.businesses.find((business) => business.id === businessId) || null;
}

function cleanup(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function markRequest(
  requestId: string,
  status: "complete" | "needs_input" | "error",
  patch: Record<string, unknown>
) {
  await getAdminDb()
    .collection("voice_action_requests")
    .doc(requestId)
    .set(
      {
        status,
        updatedAt: FieldValue.serverTimestamp(),
        ...patch,
      },
      { merge: true }
    );
}

async function upsertVoiceLead(args: {
  request: VoiceActionRequestDoc;
  extractedEmail: string | null;
  context: VoiceKnowledgeContext;
}) {
  const business = businessProfile(args.context, args.request.businessId || null);
  const leadId = voiceHash(
    `${args.request.businessId || "unknown"}:${args.extractedEmail || args.request.from || args.request.callSid || args.request.requestId}`
  );
  await getAdminDb()
    .collection("voice_crm_leads")
    .doc(leadId)
    .set(
      {
        leadId,
        source: "voice_call",
        businessId: args.request.businessId || null,
        businessName: business?.name || null,
        callSid: args.request.callSid || null,
        from: args.request.from || null,
        to: args.request.to || null,
        email: args.extractedEmail,
        transcript: args.request.transcript || "",
        status: "new",
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function processVoiceAction(input: ProcessVoiceActionInput): Promise<"complete" | "needs_input" | "error"> {
  const request = input.request;
  const transcript = cleanup(request.transcript || "");
  const email = firstEmail(transcript);
  const uid = cleanup(request.uid || "") || process.env.VOICE_ACTIONS_DEFAULT_UID || "";
  const business = businessProfile(input.context, request.businessId || null);
  const businessName = business?.name || "your team";
  const orgId = uid ? await resolveLeadRunOrgId(uid, input.log) : null;

  if (!uid && request.action !== "crm.upsertLead") {
    await markRequest(request.requestId, "needs_input", {
      reason: "missing_uid",
      message:
        "No execution user was provided. Add ?uid=<firebase_uid> to webhook URL or set VOICE_ACTIONS_DEFAULT_UID.",
    });
    return "needs_input";
  }

  if (request.action === "crm.upsertLead") {
    await upsertVoiceLead({
      request,
      extractedEmail: email,
      context: input.context,
    });
    await markRequest(request.requestId, "complete", {
      result: {
        action: request.action,
        leadUpserted: true,
      },
    });
    return "complete";
  }

  if (!email) {
    await markRequest(request.requestId, "needs_input", {
      reason: "missing_email",
      message: "No recipient email detected in transcript.",
    });
    return "needs_input";
  }

  if (orgId) {
    const domain = email.split("@")[1] || "";
    const dnc = await findDncMatch({ orgId, email, domain });
    if (dnc) {
      await markRequest(request.requestId, "needs_input", {
        reason: "dnc_block",
        message: "Recipient is on Do Not Contact list.",
        dnc: {
          entryId: dnc.entryId,
          type: dnc.type,
          value: dnc.value,
        },
      });
      return "needs_input";
    }
  }

  if (request.action === "gmail.createDraft") {
    let accessToken: string;
    try {
      accessToken = await getAccessTokenForUser(uid, input.log, { requireCapability: "gmail" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await markRequest(request.requestId, "needs_input", {
          reason: "gmail_not_enabled",
          message: error.message,
        });
        return "needs_input";
      }
      throw error;
    }

    const subject = business
      ? `${business.name} follow up from your call`
      : "Follow up from your call";
    const body = [
      `Hi,`,
      ``,
      `Thanks for speaking with ${businessName}.`,
      `We captured this request from your call:`,
      `"${transcript}"`,
      ``,
      `Reply with any details you want us to include and we will finalize next steps.`,
      ``,
      `- ${businessName}`,
    ].join("\n");

    if (input.dryRun) {
      await markRequest(request.requestId, "complete", {
        result: {
          action: request.action,
          dryRun: true,
          to: email,
          subject,
        },
      });
      return "complete";
    }

    const draftResult = await withIdempotency(
      {
        uid,
        route: "voice-actions.gmail.createDraft",
        key: actionIdempotencyKey(request.requestId, request.action, "gmail"),
        log: input.log,
      },
      () =>
        createDraftEmail(
          accessToken,
          {
            to: [email],
            subject,
            body,
          },
          input.log
        )
    );
    const draft = draftResult.data;

    await markRequest(request.requestId, "complete", {
      result: {
        action: request.action,
        to: email,
        draftId: draft.draftId,
        messageId: draft.messageId,
        threadId: draft.threadId || null,
        replayed: draftResult.replayed,
      },
    });
    return "complete";
  }

  const meetingTimeZone = business?.timeZone || DEFAULT_TIMEZONE;
  const start = parseRequestedStart(transcript, { timeZone: meetingTimeZone });
  if (!start) {
    await markRequest(request.requestId, "needs_input", {
      reason: "missing_datetime",
      message: "No clear date/time detected in transcript. Include a specific date and time.",
    });
    return "needs_input";
  }

  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const event = {
    summary: `${businessName} discovery call`,
    description: [
      "Auto-created from inbound voice request.",
      `CallSid: ${request.callSid || "unknown"}`,
      `Transcript: ${transcript}`,
    ].join("\n"),
    start: {
      dateTime: start.toISOString(),
      timeZone: meetingTimeZone,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: meetingTimeZone,
    },
    attendees: [{ email }],
    conferenceData: {
      createRequest: {
        requestId: `voice-${request.requestId}`,
      },
    },
  };

  if (input.dryRun) {
    await markRequest(request.requestId, "complete", {
      result: {
        action: request.action,
        dryRun: true,
        to: email,
        start: event.start.dateTime,
        end: event.end.dateTime,
      },
    });
    return "complete";
  }

  let accessToken: string;
  try {
    accessToken = await getAccessTokenForUser(uid, input.log, { requireCapability: "calendar" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      await markRequest(request.requestId, "needs_input", {
        reason: "calendar_not_enabled",
        message: error.message,
      });
      return "needs_input";
    }
    throw error;
  }

  const createdResult = await withIdempotency(
    {
      uid,
      route: "voice-actions.calendar.createMeet",
      key: actionIdempotencyKey(request.requestId, request.action, "calendar"),
      log: input.log,
    },
    () => createMeetingWithAvailabilityCheck(accessToken, event, "primary", input.log)
  );
  const created = createdResult.data;
  if (!created.success || !created.event) {
    await markRequest(request.requestId, "needs_input", {
      reason: "calendar_conflict",
      message: created.error || "Unable to create event.",
      proposedStart: event.start.dateTime,
    });
    return "needs_input";
  }

  await markRequest(request.requestId, "complete", {
    result: {
      action: request.action,
      eventId: created.event.id,
      htmlLink: created.event.htmlLink || null,
      meetLink: created.event.conferenceData?.entryPoints?.[0]?.uri || null,
      replayed: createdResult.replayed,
    },
  });
  return "complete";
}

async function claimRequest(requestId: string, correlationId: string): Promise<VoiceActionRequestDoc | null> {
  const ref = getAdminDb().collection("voice_action_requests").doc(requestId);
  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = (snap.data() || {}) as VoiceActionRequestDoc;
    if (String(data.status || "") !== "queued") return null;

    tx.set(
      ref,
      {
        status: "processing",
        processingCorrelationId: correlationId,
        processingStartedAt: FieldValue.serverTimestamp(),
        attempts: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ...data,
      requestId: ref.id,
    };
  });
}

export async function processQueuedVoiceActions(args: {
  context: VoiceKnowledgeContext;
  log: Logger;
  correlationId: string;
  maxTasks: number;
  dryRun: boolean;
}): Promise<VoiceActionWorkerResult> {
  const cappedMaxTasks = Math.max(1, Math.min(25, args.maxTasks));
  const queuedSnap = await getAdminDb()
    .collection("voice_action_requests")
    .where("status", "==", "queued")
    .limit(cappedMaxTasks)
    .get();

  const result: VoiceActionWorkerResult = {
    scanned: queuedSnap.size,
    claimed: 0,
    completed: 0,
    needsInput: 0,
    failed: 0,
    dryRun: args.dryRun,
  };

  for (const doc of queuedSnap.docs) {
    const claimed = await claimRequest(doc.id, args.correlationId);
    if (!claimed) continue;
    result.claimed += 1;

    try {
      const status = await processVoiceAction({
        request: claimed,
        context: args.context,
        log: args.log,
        dryRun: args.dryRun,
      });
      if (status === "complete") result.completed += 1;
      else if (status === "needs_input") result.needsInput += 1;
      else result.failed += 1;
    } catch (error) {
      await markRequest(claimed.requestId, "error", {
        message: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  }

  return result;
}
