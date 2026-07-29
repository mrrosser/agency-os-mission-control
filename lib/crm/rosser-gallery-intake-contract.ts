import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

const boundedText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const isoDateTime = z.string().datetime({ offset: true });
const uuidSuffix =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const ROSSER_GALLERY_INTAKE_LANES = [
  "artist_call",
  "vendor_interest",
  "program_proposal",
  "gallery_support",
  "community_signup",
  "contact_message",
  "meeting_interest",
] as const;

export const ROSSER_GALLERY_INTAKE_BUSINESS_UNITS = [
  "rosser_gallery",
  "rt_solutions",
] as const;

export const ROSSER_GALLERY_MEETING_INTENTS = [
  "public_gallery_visit",
  "private_gallery_walkthrough",
  "consulting_consultation",
  "artwork_conversation",
  "purchase_guidance",
  "community_collaboration",
] as const;

export const ROSSER_GALLERY_MARKETING_INTERESTS = [
  "gallery_news",
  "artist_opportunities",
  "events_programs",
  "shop_releases",
  "community_updates",
  "rt_solutions_insights",
] as const;

const galleryMarketingInterests = new Set([
  "gallery_news",
  "artist_opportunities",
  "events_programs",
  "shop_releases",
  "community_updates",
]);
const rtSolutionsMarketingInterests = new Set([
  "rt_solutions_insights",
  "community_updates",
]);

const contactSchema = z
  .object({
    name: boundedText("contact.name", 160),
    email: z.string().trim().toLowerCase().email().max(320),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "contact.phone must be an E.164 number")
      .optional(),
  })
  .strict();

const intakeMetadataSchema = z
  .object({
    offeringCategory: z
      .enum(["food", "beverage", "product", "service", "artwork", "other"])
      .optional(),
    programType: z
      .enum(["speaker", "workshop", "performance", "panel", "community_program", "other"])
      .optional(),
    supportType: z
      .enum([
        "volunteer",
        "donation",
        "sponsorship",
        "in_kind",
        "partnership",
        "community_outreach",
        "other",
      ])
      .optional(),
    contactTopic: z
      .enum([
        "general",
        "consulting",
        "artwork",
        "purchase",
        "media",
        "partnership",
        "appreciation",
        "other",
      ])
      .optional(),
  })
  .strict();

export const rosserGalleryIntakeLeadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    externalEventId: z
      .string()
      .regex(
        new RegExp(`^intake_${uuidSuffix}$`, "i"),
        "externalEventId must be an intake UUID"
      ),
    lane: z.enum(ROSSER_GALLERY_INTAKE_LANES),
    businessUnit: z.enum(ROSSER_GALLERY_INTAKE_BUSINESS_UNITS),
    occurredAt: isoDateTime,
    source: z.enum(["website_form", "website_chat", "gallery_staff"]),
    contact: contactSchema,
    summary: boundedText("summary", 4_000),
    transactionalContactConsent: z.literal(true),
    marketingConsent: z.boolean(),
    marketingInterests: z
      .array(z.enum(ROSSER_GALLERY_MARKETING_INTERESTS))
      .max(ROSSER_GALLERY_MARKETING_INTERESTS.length),
    intent: z.enum(ROSSER_GALLERY_MEETING_INTENTS).optional(),
    pagePath: z
      .string()
      .trim()
      .max(512)
      .regex(/^\/(?!\/)[^?#\r\n]*$/, "pagePath must be a relative path without a query or hash")
      .optional(),
    metadata: intakeMetadataSchema.optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    const uniqueInterests = new Set(payload.marketingInterests);
    if (uniqueInterests.size !== payload.marketingInterests.length) {
      context.addIssue({
        code: "custom",
        path: ["marketingInterests"],
        message: "marketingInterests must not contain duplicates",
      });
    }

    if (!payload.marketingConsent && payload.marketingInterests.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["marketingInterests"],
        message: "marketingInterests must be empty when marketingConsent is false",
      });
    }
    if (payload.marketingConsent && payload.marketingInterests.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["marketingInterests"],
        message: "marketingInterests are required when marketingConsent is true",
      });
    }

    const allowedInterests =
      payload.businessUnit === "rosser_gallery"
        ? galleryMarketingInterests
        : rtSolutionsMarketingInterests;
    for (const interest of payload.marketingInterests) {
      if (!allowedInterests.has(interest)) {
        context.addIssue({
          code: "custom",
          path: ["marketingInterests"],
          message: "marketing interest does not belong to the selected business unit",
        });
      }
    }

    if (payload.lane === "meeting_interest" && !payload.intent) {
      context.addIssue({
        code: "custom",
        path: ["intent"],
        message: "intent is required for meeting_interest",
      });
    }
    if (payload.lane !== "meeting_interest" && payload.intent) {
      context.addIssue({
        code: "custom",
        path: ["intent"],
        message: "intent is only accepted for meeting_interest",
      });
    }

    const allowedMetadataField: Partial<
      Record<(typeof ROSSER_GALLERY_INTAKE_LANES)[number], keyof NonNullable<typeof payload.metadata>>
    > = {
      vendor_interest: "offeringCategory",
      program_proposal: "programType",
      gallery_support: "supportType",
      contact_message: "contactTopic",
    };
    const allowedField = allowedMetadataField[payload.lane];
    for (const [field, value] of Object.entries(payload.metadata || {})) {
      if (value !== undefined && field !== allowedField) {
        context.addIssue({
          code: "custom",
          path: ["metadata", field],
          message: `metadata.${field} is not accepted for ${payload.lane}`,
        });
      }
    }
  });

export type RosserGalleryIntakeLeadV1 = z.infer<
  typeof rosserGalleryIntakeLeadV1Schema
>;

const MAX_DELIVERY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export function assertRosserGalleryIntakeTimestampBounds(
  payload: RosserGalleryIntakeLeadV1,
  receivedAt: Date
): void {
  const occurredAt = Date.parse(payload.occurredAt);
  const receivedAtMs = receivedAt.getTime();
  if (
    occurredAt < receivedAtMs - MAX_DELIVERY_AGE_MS ||
    occurredAt > receivedAtMs + MAX_FUTURE_SKEW_MS
  ) {
    throw new ApiError(400, "Intake event timestamp is outside the accepted window");
  }
}
