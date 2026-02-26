import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { createSocialDraftWithApprovalDispatch } from "@/lib/social/drafts";

const channelSchema = z.enum([
  "instagram_story",
  "instagram_post",
  "facebook_story",
  "facebook_post",
]);

const mediaSchema = z.object({
  type: z.enum(["image", "video"]),
  url: z.string().trim().url().max(2000),
  thumbnailUrl: z.string().trim().url().max(2000).optional(),
  title: z.string().trim().max(120).optional(),
});

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
  channels: z.array(channelSchema).min(1).max(6).default(["instagram_post", "facebook_post"]),
  caption: z.string().trim().min(1).max(5000).optional(),
  media: z.array(mediaSchema).max(8).default([]),
  source: z.string().trim().min(1).max(80).default("openclaw_social_orchestrator"),
  requestApproval: z.boolean().default(true),
  weekKey: z.string().trim().min(1).max(40).optional(),
});

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function readConfiguredWorkerToken(): string {
  const primary = String(process.env.SOCIAL_DRAFT_WORKER_TOKEN || "").trim();
  if (primary) return primary;
  const day30 = String(process.env.REVENUE_DAY30_WORKER_TOKEN || "").trim();
  if (day30) return day30;
  const day2 = String(process.env.REVENUE_DAY2_WORKER_TOKEN || "").trim();
  if (day2) return day2;
  return String(process.env.REVENUE_DAY1_WORKER_TOKEN || "").trim();
}

function authorizeWorker(request: Request): void {
  const configured = readConfiguredWorkerToken();
  if (!configured) {
    throw new ApiError(
      503,
      "SOCIAL_DRAFT_WORKER_TOKEN is not configured (or fallback revenue worker token)"
    );
  }
  const candidate =
    String(request.headers.get("x-social-draft-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== configured) {
    throw new ApiError(403, "Forbidden");
  }
}

function resolveApprovalBaseUrl(request: { url: string; nextUrl?: { origin?: string } }): string {
  const configured = String(process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return (request.nextUrl?.origin || new URL(request.url).origin).replace(/\/+$/, "");
}

function resolveDefaultUid(): string {
  const candidates = [
    process.env.SOCIAL_DRAFT_UID,
    process.env.REVENUE_AUTOMATION_UID,
    process.env.REVENUE_DAY30_UID,
    process.env.REVENUE_DAY2_UID,
    process.env.REVENUE_DAY1_UID,
    process.env.VOICE_ACTIONS_DEFAULT_UID,
    process.env.SQUARE_WEBHOOK_DEFAULT_UID,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function getDateInTimeZone(timeZone: string, value = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const from = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  const year = from("year");
  const month = from("month");
  const day = from("day");
  return new Date(Date.UTC(year, Math.max(0, month - 1), Math.max(1, day), 12, 0, 0));
}

function toIsoWeekKey(value: Date): string {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const weekYear = date.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function resolveWeekKey(override?: string): string {
  const direct = String(override || "").trim();
  if (direct) return direct;
  const timeZone = String(process.env.SOCIAL_DRAFT_RNG_WEEKLY_TIMEZONE || "America/Chicago").trim();
  const zonedDate = getDateInTimeZone(timeZone);
  return toIsoWeekKey(zonedDate);
}

function defaultCaptionForWeek(weekKey: string): string {
  return [
    `RNG Weekly Spotlight (${weekKey})`,
    "Feature one top collectible and the story behind it.",
    "Ask followers which piece should be highlighted next.",
    "Close with a profile-link CTA for the full collection.",
  ].join(" ");
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);
    const uid = String(body.uid || "").trim() || resolveDefaultUid();
    if (!uid) {
      throw new ApiError(
        400,
        "Missing uid. Provide uid in request body or configure SOCIAL_DRAFT_UID (or revenue uid fallback)."
      );
    }

    const weekKey = resolveWeekKey(body.weekKey);
    const idempotencyKey =
      getIdempotencyKey(request, body) || `social-draft-rng-weekly-${uid}-${weekKey}`;

    const result = await withIdempotency(
      {
        uid,
        route: "social.drafts.rng_weekly.worker_task.create",
        key: idempotencyKey,
        log,
      },
      async () =>
        createSocialDraftWithApprovalDispatch({
          uid,
          businessKey: "rng",
          channels: body.channels,
          caption: String(body.caption || "").trim() || defaultCaptionForWeek(weekKey),
          media: body.media,
          source: body.source,
          publishAt: null,
          correlationId,
          requestApproval: body.requestApproval,
          approvalBaseUrl: resolveApprovalBaseUrl(request),
          log,
        })
    );

    return NextResponse.json({
      ok: true,
      replayed: result.replayed,
      weekKey,
      ...result.data,
      correlationId,
    });
  },
  { route: "social.drafts.rng_weekly.worker_task.create" }
);
