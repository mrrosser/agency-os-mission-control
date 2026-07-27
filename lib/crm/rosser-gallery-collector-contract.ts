import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

const boundedText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const isoDateTime = z.string().datetime({ offset: true });

export const rosserGalleryCollectorInterestSchema = z.enum([
  "available-work",
  "mini",
  "master",
  "private-viewing",
  "commission",
]);

export type RosserGalleryCollectorInterest = z.infer<
  typeof rosserGalleryCollectorInterestSchema
>;

const campaignTouchSchema = z
  .object({
    captured_at: isoDateTime,
    utm_source: z.literal("meta").optional(),
    utm_medium: z.literal("paid_social").optional(),
    utm_campaign: z.literal("the_braider_atlanta_45plus").optional(),
    utm_content: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)
      .optional(),
    utm_term: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/)
      .optional(),
    market: z.literal("atlanta").optional(),
    language: z.literal("en-US").optional(),
    sculpture: z.literal("the-braider").optional(),
    creative_hook: z.enum(["lineage", "process", "futurity"]).optional(),
  })
  .strict();

export const rosserGalleryCollectorLeadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    externalEventId: z
      .string()
      .regex(
        /^rg_collector_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        "externalEventId must be an rg_collector UUID"
      ),
    capturedAt: isoDateTime,
    contact: z
      .object({
        name: boundedText("contact.name", 160),
        email: z.string().trim().toLowerCase().email().max(320),
      })
      .strict(),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: rosserGalleryCollectorInterestSchema,
        note: z.string().trim().max(4_000).optional(),
      })
      .strict(),
    permissions: z
      .object({
        responseEmail: z.literal(true),
        marketingEmail: z.boolean(),
        sms: z.literal(false),
        rtSolutions: z.literal(false),
        consentVersion: z.literal("collector-v1"),
        consentedAt: isoDateTime.nullable(),
      })
      .strict(),
    campaign: z
      .object({
        id: z.literal("the-braider-atlanta"),
        market: z.literal("atlanta"),
        language: z.literal("en-US"),
        sculpture: z.literal("the-braider"),
        creativeHook: z.enum(["lineage", "process", "futurity"]).optional(),
        firstTouch: campaignTouchSchema,
        lastTouch: campaignTouchSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.permissions.marketingEmail && payload.permissions.consentedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "consentedAt"],
        message: "consentedAt is required when marketingEmail is true",
      });
    }

    if (!payload.permissions.marketingEmail && payload.permissions.consentedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "consentedAt"],
        message: "consentedAt must be null when marketingEmail is false",
      });
    }

    const capturedAt = Date.parse(payload.capturedAt);
    const firstTouchAt = Date.parse(payload.campaign.firstTouch.captured_at);
    const lastTouchAt = Date.parse(payload.campaign.lastTouch.captured_at);
    if (firstTouchAt > lastTouchAt || lastTouchAt > capturedAt) {
      context.addIssue({
        code: "custom",
        path: ["campaign"],
        message: "Attribution timestamps must satisfy firstTouch <= lastTouch <= capturedAt",
      });
    }
    if (
      payload.permissions.consentedAt !== null &&
      Date.parse(payload.permissions.consentedAt) > capturedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "consentedAt"],
        message: "consentedAt cannot be later than capturedAt",
      });
    }
  });

export type RosserGalleryCollectorLeadV1 = z.infer<
  typeof rosserGalleryCollectorLeadV1Schema
>;

const MAX_DELIVERY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_ATTRIBUTION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONSENT_CAPTURE_GAP_MS = 15 * 60 * 1_000;

export function assertRosserGalleryCollectorLeadTimestampBounds(
  payload: RosserGalleryCollectorLeadV1,
  receivedAt: Date
): void {
  const capturedAt = Date.parse(payload.capturedAt);
  const receivedAtMs = receivedAt.getTime();
  const firstTouchAt = Date.parse(payload.campaign.firstTouch.captured_at);
  if (
    capturedAt < receivedAtMs - MAX_DELIVERY_AGE_MS ||
    capturedAt > receivedAtMs + MAX_FUTURE_SKEW_MS ||
    firstTouchAt < capturedAt - MAX_ATTRIBUTION_LOOKBACK_MS
  ) {
    throw new ApiError(400, "Collector lead timestamp is outside the accepted window");
  }

  if (payload.permissions.consentedAt !== null) {
    const consentedAt = Date.parse(payload.permissions.consentedAt);
    if (capturedAt - consentedAt > MAX_CONSENT_CAPTURE_GAP_MS) {
      throw new ApiError(400, "Marketing consent timestamp is outside the accepted window");
    }
  }
}

export function offerCodeForCollectorInterest(
  interest: RosserGalleryCollectorInterest
):
  | "RNG-MINI-REPLICA"
  | "RNG-COLLECTOR-PREVIEW"
  | "RNG-COMMISSION-SCULPTURE" {
  if (interest === "mini") return "RNG-MINI-REPLICA";
  if (interest === "commission") return "RNG-COMMISSION-SCULPTURE";
  return "RNG-COLLECTOR-PREVIEW";
}
