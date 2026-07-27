import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/collector-lead.v1.json";
import etsyFixtureJson from "@/contracts/rosser-gallery/etsy-launch-waitlist.v2.json";
import whiteLinenFixtureJson from "@/contracts/rosser-gallery/white-linen-preview-lead.v2.json";
import {
  assertRosserGalleryCollectorLeadTimestampBounds,
  offerCodeForCollectorInterest,
  offerCodeForRosserGalleryLead,
  rosserGalleryCollectorLeadSchema,
  rosserGalleryCollectorLeadV1Schema,
  rosserGalleryEtsyLeadV2Schema,
  rosserGalleryWhiteLinenLeadV2Schema,
} from "@/lib/crm/rosser-gallery-collector-contract";

function fixture(): Record<string, unknown> {
  return structuredClone(fixtureJson) as Record<string, unknown>;
}

function whiteLinenFixture(): Record<string, unknown> {
  return structuredClone(whiteLinenFixtureJson) as Record<string, unknown>;
}

function etsyFixture(): Record<string, unknown> {
  return structuredClone(etsyFixtureJson) as Record<string, unknown>;
}

describe("Rosser Gallery collector-lead v1 contract", () => {
  it("accepts and normalizes the shared synthetic fixture", () => {
    const parsed = rosserGalleryCollectorLeadV1Schema.parse(fixture());

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.contact.email).toBe("collector@example.com");
    expect(parsed.campaign.id).toBe("the-braider-atlanta");
    expect(parsed.permissions.marketingEmail).toBe(false);
  });

  it("rejects unknown root and attribution fields", () => {
    const rootExtra = fixture();
    rootExtra.fbclid = "not-allowlisted";
    expect(rosserGalleryCollectorLeadV1Schema.safeParse(rootExtra).success).toBe(false);

    const touchExtra = fixture();
    const campaign = touchExtra.campaign as Record<string, unknown>;
    const firstTouch = campaign.firstTouch as Record<string, unknown>;
    firstTouch.fbclid = "not-allowlisted";
    expect(rosserGalleryCollectorLeadV1Schema.safeParse(touchExtra).success).toBe(false);
  });

  it("requires an explicit timestamp for marketing consent", () => {
    const missingTimestamp = fixture();
    const permissions = missingTimestamp.permissions as Record<string, unknown>;
    permissions.marketingEmail = true;
    expect(rosserGalleryCollectorLeadV1Schema.safeParse(missingTimestamp).success).toBe(
      false
    );

    permissions.consentedAt = "2026-07-25T15:30:00.000Z";
    expect(rosserGalleryCollectorLeadV1Schema.safeParse(missingTimestamp).success).toBe(
      true
    );
  });

  it("requires consentedAt to be null when marketing is unchecked", () => {
    const payload = fixture();
    const permissions = payload.permissions as Record<string, unknown>;
    permissions.consentedAt = "2026-07-25T15:30:00.000Z";

    expect(rosserGalleryCollectorLeadV1Schema.safeParse(payload).success).toBe(false);
  });

  it("rejects malformed external event identifiers", () => {
    const payload = fixture();
    payload.externalEventId = "contact-123";

    expect(rosserGalleryCollectorLeadV1Schema.safeParse(payload).success).toBe(false);
  });

  it("rejects drift from the server-pinned Atlanta campaign identity", () => {
    for (const [field, value] of [
      ["market", "new-orleans"],
      ["language", "fr-FR"],
      ["sculpture", "another-work"],
    ] as const) {
      const payload = fixture();
      const campaign = payload.campaign as Record<string, unknown>;
      campaign[field] = value;
      expect(rosserGalleryCollectorLeadV1Schema.safeParse(payload).success).toBe(false);
    }

    const nestedDrift = fixture();
    const nestedCampaign = nestedDrift.campaign as Record<string, unknown>;
    const nestedLastTouch = nestedCampaign.lastTouch as Record<string, unknown>;
    nestedLastTouch.market = "new-orleans";
    expect(rosserGalleryCollectorLeadV1Schema.safeParse(nestedDrift).success).toBe(
      false
    );
  });

  it("rejects reversed attribution timestamps", () => {
    const payload = fixture();
    const campaign = payload.campaign as Record<string, unknown>;
    const firstTouch = campaign.firstTouch as Record<string, unknown>;
    firstTouch.captured_at = "2026-07-25T15:29:30.000Z";
    const lastTouch = campaign.lastTouch as Record<string, unknown>;
    lastTouch.captured_at = "2026-07-25T15:20:00.000Z";

    expect(rosserGalleryCollectorLeadV1Schema.safeParse(payload).success).toBe(false);
  });

  it("enforces delivery-age, future-skew, and consent-capture bounds", () => {
    const parsed = rosserGalleryCollectorLeadV1Schema.parse(fixture());
    expect(() =>
      assertRosserGalleryCollectorLeadTimestampBounds(
        parsed,
        new Date("2026-08-03T16:00:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      assertRosserGalleryCollectorLeadTimestampBounds(
        parsed,
        new Date("2026-07-25T15:20:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));

    const staleConsent = fixture();
    const permissions = staleConsent.permissions as Record<string, unknown>;
    permissions.marketingEmail = true;
    permissions.consentedAt = "2026-07-25T15:00:00.000Z";
    const parsedStaleConsent = rosserGalleryCollectorLeadV1Schema.parse(staleConsent);
    expect(() =>
      assertRosserGalleryCollectorLeadTimestampBounds(
        parsedStaleConsent,
        new Date("2026-07-25T16:00:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("routes purchase and commission interests to the matching CRM offers", () => {
    expect(offerCodeForCollectorInterest("mini")).toBe("RNG-MINI-REPLICA");
    expect(offerCodeForCollectorInterest("commission")).toBe(
      "RNG-COMMISSION-SCULPTURE"
    );
    expect(offerCodeForCollectorInterest("master")).toBe(
      "RNG-COLLECTOR-PREVIEW"
    );
  });
});

describe("Rosser Gallery campaign lead v2 contracts", () => {
  it("accepts the pinned White Linen lead and every lead-only event type", () => {
    const preview = rosserGalleryWhiteLinenLeadV2Schema.parse(whiteLinenFixture());
    expect(preview.lane).toBe("white_linen_night_nola_2026");
    expect(preview.campaign.namespace).toBe("white_linen_night_nola_2026");
    expect(preview.campaign.firstTouch.utm_term).toBe("broad_local");

    for (const [eventType, interest] of [
      ["private_viewing_inquiry", "private-viewing"],
      ["commission_inquiry", "commission"],
    ] as const) {
      const payload = whiteLinenFixture();
      payload.eventType = eventType;
      const collector = payload.collector as Record<string, unknown>;
      collector.interest = interest;
      expect(rosserGalleryWhiteLinenLeadV2Schema.safeParse(payload).success).toBe(true);
    }
  });

  it("allows direct and exact organic White Linen attribution but rejects mismatches", () => {
    const organic = whiteLinenFixture();
    const campaign = organic.campaign as Record<string, unknown>;
    for (const key of ["firstTouch", "lastTouch"] as const) {
      const touch = campaign[key] as Record<string, unknown>;
      touch.utm_source = "instagram";
      touch.utm_medium = "organic_social";
      delete touch.utm_term;
    }
    expect(rosserGalleryWhiteLinenLeadV2Schema.safeParse(organic).success).toBe(true);

    const direct = whiteLinenFixture();
    const directCampaign = direct.campaign as Record<string, unknown>;
    for (const key of ["firstTouch", "lastTouch"] as const) {
      const touch = directCampaign[key] as Record<string, unknown>;
      for (const field of [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
      ]) {
        delete touch[field];
      }
    }
    expect(rosserGalleryWhiteLinenLeadV2Schema.safeParse(direct).success).toBe(true);

    const mismatched = whiteLinenFixture();
    const mismatchedCampaign = mismatched.campaign as Record<string, unknown>;
    const firstTouch = mismatchedCampaign.firstTouch as Record<string, unknown>;
    firstTouch.utm_source = "instagram";
    firstTouch.utm_medium = "paid_social";
    expect(rosserGalleryWhiteLinenLeadV2Schema.safeParse(mismatched).success).toBe(
      false
    );

    const badTerm = whiteLinenFixture();
    const badTermCampaign = badTerm.campaign as Record<string, unknown>;
    const badTermTouch = badTermCampaign.firstTouch as Record<string, unknown>;
    badTermTouch.utm_term = "broad_us";
    expect(rosserGalleryWhiteLinenLeadV2Schema.safeParse(badTerm).success).toBe(false);
  });

  it("accepts Etsy waitlist and explicit product inquiry leads", () => {
    const waitlist = rosserGalleryEtsyLeadV2Schema.parse(etsyFixture());
    expect(waitlist.campaign.shop).toBe("RosserGallery");
    expect(offerCodeForRosserGalleryLead(waitlist)).toBe("RNG-MINI-REPLICA");

    const inquiry = etsyFixture();
    inquiry.eventType = "etsy_product_inquiry";
    inquiry.externalEventId =
      "rg_etsy_inquiry_b8223c6e-71f6-48f5-866b-51f2b1ad370b";
    const collector = inquiry.collector as Record<string, unknown>;
    collector.interest = "product-inquiry";
    collector.work = "transceiver";
    collector.note = "Can you tell me how the finish will look on this Mini?";

    expect(rosserGalleryEtsyLeadV2Schema.safeParse(inquiry).success).toBe(true);

    delete collector.note;
    expect(rosserGalleryEtsyLeadV2Schema.safeParse(inquiry).success).toBe(false);
  });

  it("pins Etsy UTM source/medium pairs and campaign content identifiers", () => {
    const email = etsyFixture();
    const campaign = email.campaign as Record<string, unknown>;
    for (const key of ["firstTouch", "lastTouch"] as const) {
      const touch = campaign[key] as Record<string, unknown>;
      touch.utm_source = "email";
      touch.utm_medium = "email";
      touch.utm_content = "launch_email_v1";
      delete touch.utm_term;
    }
    expect(rosserGalleryEtsyLeadV2Schema.safeParse(email).success).toBe(true);

    const mismatched = etsyFixture();
    const mismatchedCampaign = mismatched.campaign as Record<string, unknown>;
    const firstTouch = mismatchedCampaign.firstTouch as Record<string, unknown>;
    firstTouch.utm_source = "email";
    firstTouch.utm_medium = "paid_social";
    expect(rosserGalleryEtsyLeadV2Schema.safeParse(mismatched).success).toBe(false);

    const badContent = etsyFixture();
    const badContentCampaign = badContent.campaign as Record<string, unknown>;
    const badContentTouch = badContentCampaign.firstTouch as Record<string, unknown>;
    badContentTouch.utm_content = "purchase_reel_v1";
    expect(rosserGalleryEtsyLeadV2Schema.safeParse(badContent).success).toBe(false);
  });

  it("rejects arbitrary tags, lane drift, and browser commerce/check-in events", () => {
    for (const eventType of [
      "purchase",
      "event_checkin",
      "etsy_order_created",
      "etsy_order_paid",
      "etsy_order_refunded",
    ]) {
      const payload = eventType.startsWith("etsy_") ? etsyFixture() : whiteLinenFixture();
      payload.eventType = eventType;
      expect(rosserGalleryCollectorLeadSchema.safeParse(payload).success).toBe(false);
    }

    const tagged = etsyFixture();
    tagged.tags = ["rt_ai_workflow"];
    expect(rosserGalleryCollectorLeadSchema.safeParse(tagged).success).toBe(false);

    const drifted = whiteLinenFixture();
    const campaign = drifted.campaign as Record<string, unknown>;
    campaign.namespace = "etsy_store_launch_20260801";
    expect(rosserGalleryCollectorLeadSchema.safeParse(drifted).success).toBe(false);
  });

  it("applies the same delivery and consent timestamp bounds to v2", () => {
    const payload = rosserGalleryCollectorLeadSchema.parse(etsyFixture());
    expect(() =>
      assertRosserGalleryCollectorLeadTimestampBounds(
        payload,
        new Date("2026-07-27T16:31:00.000Z")
      )
    ).not.toThrow();
    expect(() =>
      assertRosserGalleryCollectorLeadTimestampBounds(
        payload,
        new Date("2026-08-05T16:31:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
