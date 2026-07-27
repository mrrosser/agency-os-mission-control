import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/collector-lead.v1.json";
import {
  assertRosserGalleryCollectorLeadTimestampBounds,
  offerCodeForCollectorInterest,
  rosserGalleryCollectorLeadV1Schema,
} from "@/lib/crm/rosser-gallery-collector-contract";

function fixture(): Record<string, unknown> {
  return structuredClone(fixtureJson) as Record<string, unknown>;
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
