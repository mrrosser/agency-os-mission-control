import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

const boundedText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const isoDateTime = z.string().datetime({ offset: true });
const uuidSuffix =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const contactSchema = z
  .object({
    name: boundedText("contact.name", 160),
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();

function permissionsSchema<const T extends string>(consentVersion: T) {
  return z
    .object({
      responseEmail: z.literal(true),
      marketingEmail: z.boolean(),
      sms: z.literal(false),
      rtSolutions: z.literal(false),
      consentVersion: z.literal(consentVersion),
      consentedAt: isoDateTime.nullable(),
    })
    .strict();
}

type UtmTouch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
};

function requireCompleteUtm(
  touch: UtmTouch,
  context: z.RefinementCtx,
  campaign: string,
  allowedPairs: ReadonlySet<string>
): void {
  const hasAnyUtm = Object.entries(touch).some(
    ([key, value]) => key.startsWith("utm_") && value !== undefined
  );
  if (!hasAnyUtm) return;

  for (const field of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    if (touch[field] === undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required when attribution is present`,
      });
    }
  }

  if (touch.utm_campaign !== undefined && touch.utm_campaign !== campaign) {
    context.addIssue({
      code: "custom",
      path: ["utm_campaign"],
      message: "utm_campaign does not match the allowlisted campaign namespace",
    });
  }

  if (
    touch.utm_source !== undefined &&
    touch.utm_medium !== undefined &&
    !allowedPairs.has(`${touch.utm_source}/${touch.utm_medium}`)
  ) {
    context.addIssue({
      code: "custom",
      path: ["utm_medium"],
      message: "utm_source and utm_medium are not an allowlisted pair",
    });
  }
}

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

const atlantaCampaignTouchSchema = z
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

const sharedV1Shape = {
  schemaVersion: z.literal(1),
  externalEventId: z
    .string()
    .regex(
      new RegExp(`^rg_collector_${uuidSuffix}$`, "i"),
      "externalEventId must be an rg_collector UUID"
    ),
  capturedAt: isoDateTime,
  contact: contactSchema,
  collector: z
    .object({
      city: boundedText("collector.city", 160),
      interest: rosserGalleryCollectorInterestSchema,
      note: z.string().trim().max(4_000).optional(),
    })
    .strict(),
  permissions: permissionsSchema("collector-v1"),
  campaign: z
    .object({
      id: z.literal("the-braider-atlanta"),
      market: z.literal("atlanta"),
      language: z.literal("en-US"),
      sculpture: z.literal("the-braider"),
      creativeHook: z.enum(["lineage", "process", "futurity"]).optional(),
      firstTouch: atlantaCampaignTouchSchema,
      lastTouch: atlantaCampaignTouchSchema,
    })
    .strict(),
};

function addTemporalOrderingIssues(
  payload: {
    capturedAt: string;
    permissions: { marketingEmail: boolean; consentedAt: string | null };
    campaign: {
      firstTouch: { captured_at: string };
      lastTouch: { captured_at: string };
    };
  },
  context: z.RefinementCtx
): void {
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
}

export const rosserGalleryCollectorLeadV1Schema = z
  .object(sharedV1Shape)
  .strict()
  .superRefine(addTemporalOrderingIssues);

export type RosserGalleryCollectorLeadV1 = z.infer<
  typeof rosserGalleryCollectorLeadV1Schema
>;

const whiteLinenUtmPairs = new Set([
  "meta/paid_social",
  "instagram/organic_social",
  "facebook/organic_social",
  "offline_qr/event",
]);

const whiteLinenTouchSchema = z
  .object({
    captured_at: isoDateTime,
    utm_source: z
      .enum(["meta", "instagram", "facebook", "offline_qr"])
      .optional(),
    utm_medium: z.enum(["paid_social", "organic_social", "event"]).optional(),
    utm_campaign: z.literal("white_linen_night_nola_2026").optional(),
    utm_content: z
      .enum(["career_progression_34s_reel", "date_reminder_15s_reel", "event_qr"])
      .optional(),
    utm_term: z.literal("broad_local").optional(),
    market: z.literal("new_orleans").optional(),
    language: z.literal("en-US").optional(),
    event: z.literal("white_linen_night_2026").optional(),
  })
  .strict()
  .superRefine((touch, context) => {
    requireCompleteUtm(
      touch,
      context,
      "white_linen_night_nola_2026",
      whiteLinenUtmPairs
    );
  });

const whiteLinenCampaignSchema = z
  .object({
    id: z.literal("white_linen_night_nola_2026"),
    namespace: z.literal("white_linen_night_nola_2026"),
    market: z.literal("new_orleans"),
    language: z.literal("en-US"),
    event: z.literal("white_linen_night_2026"),
    firstTouch: whiteLinenTouchSchema,
    lastTouch: whiteLinenTouchSchema,
  })
  .strict();

const whiteLinenBaseShape = {
  schemaVersion: z.literal(2),
  lane: z.literal("white_linen_night_nola_2026"),
  externalEventId: z
    .string()
    .regex(
      new RegExp(`^rg_white_linen_${uuidSuffix}$`, "i"),
      "externalEventId must be an rg_white_linen UUID"
    ),
  capturedAt: isoDateTime,
  contact: contactSchema,
  permissions: permissionsSchema("white-linen-preview-v2"),
  campaign: whiteLinenCampaignSchema,
};

const whiteLinenPreviewLeadSchema = z
  .object({
    ...whiteLinenBaseShape,
    eventType: z.literal("event_preview_lead"),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: z.literal("event-preview"),
        note: z.string().trim().max(4_000).optional(),
      })
      .strict(),
  })
  .strict();

const whiteLinenPrivateViewingInquirySchema = z
  .object({
    ...whiteLinenBaseShape,
    eventType: z.literal("private_viewing_inquiry"),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: z.literal("private-viewing"),
        note: z.string().trim().max(4_000).optional(),
      })
      .strict(),
  })
  .strict();

const whiteLinenCommissionInquirySchema = z
  .object({
    ...whiteLinenBaseShape,
    eventType: z.literal("commission_inquiry"),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: z.literal("commission"),
        note: z.string().trim().max(4_000).optional(),
      })
      .strict(),
  })
  .strict();

export const rosserGalleryWhiteLinenLeadV2Schema = z
  .discriminatedUnion("eventType", [
    whiteLinenPreviewLeadSchema,
    whiteLinenPrivateViewingInquirySchema,
    whiteLinenCommissionInquirySchema,
  ])
  .superRefine(addTemporalOrderingIssues);

export type RosserGalleryWhiteLinenLeadV2 = z.infer<
  typeof rosserGalleryWhiteLinenLeadV2Schema
>;

export const rosserGalleryEtsyWorkSchema = z.enum([
  "rooted-in-agony",
  "the-braider",
  "the-nurturer",
  "transceiver",
  "the-wave",
  "bearer-of-the-code",
  "godmother-earth",
]);

const etsyUtmPairs = new Set([
  "instagram/organic_social",
  "instagram/paid_social",
  "facebook/organic_social",
  "facebook/paid_social",
  "email/email",
]);

const etsyTouchSchema = z
  .object({
    captured_at: isoDateTime,
    utm_source: z.enum(["instagram", "facebook", "email"]).optional(),
    utm_medium: z.enum(["organic_social", "paid_social", "email"]).optional(),
    utm_campaign: z.literal("etsy_store_launch_20260801").optional(),
    utm_content: z
      .string()
      .trim()
      .regex(/^(prelaunch|collection|launch|process|day5)_(reel|story|feed|email)_v1$/)
      .optional(),
    utm_term: z.enum(["warm", "broad_us"]).optional(),
    market: z.literal("united_states").optional(),
    language: z.literal("en-US").optional(),
    shop: z.literal("RosserGallery").optional(),
  })
  .strict()
  .superRefine((touch, context) => {
    requireCompleteUtm(touch, context, "etsy_store_launch_20260801", etsyUtmPairs);
  });

const etsyCampaignSchema = z
  .object({
    id: z.literal("etsy_store_launch_20260801"),
    namespace: z.literal("etsy_store_launch_20260801"),
    market: z.literal("united_states"),
    language: z.literal("en-US"),
    shop: z.literal("RosserGallery"),
    firstTouch: etsyTouchSchema,
    lastTouch: etsyTouchSchema,
  })
  .strict();

const etsyBaseShape = {
  schemaVersion: z.literal(2),
  lane: z.literal("etsy_store_launch_20260801"),
  capturedAt: isoDateTime,
  contact: contactSchema,
  permissions: permissionsSchema("etsy-waitlist-v2"),
  campaign: etsyCampaignSchema,
};

const etsyWaitlistLeadSchema = z
  .object({
    ...etsyBaseShape,
    eventType: z.literal("etsy_waitlist_submit"),
    externalEventId: z
      .string()
      .regex(
        new RegExp(`^rg_etsy_waitlist_${uuidSuffix}$`, "i"),
        "externalEventId must be an rg_etsy_waitlist UUID"
      ),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: z.enum(["store-launch", "mini"]),
        work: rosserGalleryEtsyWorkSchema.optional(),
        note: z.string().trim().max(4_000).optional(),
      })
      .strict(),
  })
  .strict();

const etsyProductInquirySchema = z
  .object({
    ...etsyBaseShape,
    eventType: z.literal("etsy_product_inquiry"),
    externalEventId: z
      .string()
      .regex(
        new RegExp(`^rg_etsy_inquiry_${uuidSuffix}$`, "i"),
        "externalEventId must be an rg_etsy_inquiry UUID"
      ),
    collector: z
      .object({
        city: boundedText("collector.city", 160),
        interest: z.literal("product-inquiry"),
        work: rosserGalleryEtsyWorkSchema,
        note: boundedText("collector.note", 4_000),
      })
      .strict(),
  })
  .strict();

export const rosserGalleryEtsyLeadV2Schema = z
  .discriminatedUnion("eventType", [
    etsyWaitlistLeadSchema,
    etsyProductInquirySchema,
  ])
  .superRefine(addTemporalOrderingIssues);

export type RosserGalleryEtsyLeadV2 = z.infer<
  typeof rosserGalleryEtsyLeadV2Schema
>;

export const rosserGalleryCollectorLeadSchema = z.union([
  rosserGalleryCollectorLeadV1Schema,
  rosserGalleryWhiteLinenLeadV2Schema,
  rosserGalleryEtsyLeadV2Schema,
]);

export type RosserGalleryCollectorLead = z.infer<
  typeof rosserGalleryCollectorLeadSchema
>;

export type RosserGalleryLeadInterest =
  RosserGalleryCollectorLead["collector"]["interest"];

export const ROSSER_GALLERY_SUPPORTED_LEAD_LANES = [
  {
    schemaVersion: 1,
    campaignId: "the-braider-atlanta",
    events: ["collector_request"],
  },
  {
    schemaVersion: 2,
    campaignId: "white_linen_night_nola_2026",
    events: [
      "event_preview_lead",
      "private_viewing_inquiry",
      "commission_inquiry",
    ],
  },
  {
    schemaVersion: 2,
    campaignId: "etsy_store_launch_20260801",
    events: ["etsy_waitlist_submit", "etsy_product_inquiry"],
  },
] as const;

const MAX_DELIVERY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_ATTRIBUTION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONSENT_CAPTURE_GAP_MS = 15 * 60 * 1_000;

export function assertRosserGalleryCollectorLeadTimestampBounds(
  payload: RosserGalleryCollectorLead,
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

export function offerCodeForRosserGalleryLead(
  payload: RosserGalleryCollectorLead
):
  | "RNG-MINI-REPLICA"
  | "RNG-COLLECTOR-PREVIEW"
  | "RNG-COMMISSION-SCULPTURE" {
  if (payload.schemaVersion === 1) {
    return offerCodeForCollectorInterest(payload.collector.interest);
  }
  if (payload.lane === "etsy_store_launch_20260801") {
    return "RNG-MINI-REPLICA";
  }
  if (payload.collector.interest === "commission") {
    return "RNG-COMMISSION-SCULPTURE";
  }
  return "RNG-COLLECTOR-PREVIEW";
}
