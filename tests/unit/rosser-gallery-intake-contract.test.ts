import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/intake-lead.v1.json";
import {
  assertRosserGalleryIntakeTimestampBounds,
  rosserGalleryIntakeLeadV1Schema,
} from "@/lib/crm/rosser-gallery-intake-contract";

function fixture(): Record<string, unknown> {
  return structuredClone(fixtureJson) as Record<string, unknown>;
}

describe("Rosser Gallery intake-lead v1 contract", () => {
  it("accepts and normalizes the strict synthetic fixture", () => {
    const payload = fixture();
    const contact = payload.contact as Record<string, unknown>;
    contact.email = "COMMUNITY.MEMBER@EXAMPLE.COM";
    const parsed = rosserGalleryIntakeLeadV1Schema.parse(payload);

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      lane: "meeting_interest",
      businessUnit: "rosser_gallery",
      contact: { email: "community.member@example.com" },
      intent: "private_gallery_walkthrough",
      transactionalContactConsent: true,
      marketingConsent: false,
      marketingInterests: [],
    });
  });

  it("accepts every lane with only its allowlisted discriminator", () => {
    const cases = [
      ["artist_call", undefined],
      ["vendor_interest", { offeringCategory: "food" }],
      ["program_proposal", { programType: "workshop" }],
      ["gallery_support", { supportType: "volunteer" }],
      ["community_signup", undefined],
      ["contact_message", { contactTopic: "appreciation" }],
      ["meeting_interest", undefined],
    ] as const;

    for (const [lane, metadata] of cases) {
      const payload = fixture();
      payload.lane = lane;
      if (lane !== "meeting_interest") delete payload.intent;
      if (metadata) payload.metadata = metadata;
      expect(rosserGalleryIntakeLeadV1Schema.safeParse(payload).success).toBe(true);
    }
  });

  it("requires an allowlisted intent only for meeting_interest", () => {
    const missing = fixture();
    delete missing.intent;
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(missing).success).toBe(false);

    const wrongLane = fixture();
    wrongLane.lane = "artist_call";
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(wrongLane).success).toBe(false);

    const arbitrary = fixture();
    arbitrary.intent = "book_any_calendar_event";
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(arbitrary).success).toBe(false);
  });

  it("keeps marketing consent explicit, unique, and business scoped", () => {
    const optedIn = fixture();
    optedIn.marketingConsent = true;
    optedIn.marketingInterests = ["gallery_news", "events_programs"];
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(optedIn).success).toBe(true);

    const uncheckedWithInterests = fixture();
    uncheckedWithInterests.marketingInterests = ["gallery_news"];
    expect(
      rosserGalleryIntakeLeadV1Schema.safeParse(uncheckedWithInterests).success
    ).toBe(false);

    const rtCrossPurpose = fixture();
    rtCrossPurpose.businessUnit = "rt_solutions";
    rtCrossPurpose.marketingConsent = true;
    rtCrossPurpose.marketingInterests = ["gallery_news"];
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(rtCrossPurpose).success).toBe(
      false
    );

    const duplicate = fixture();
    duplicate.marketingConsent = true;
    duplicate.marketingInterests = ["gallery_news", "gallery_news"];
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects lane-mismatched metadata, unknown fields, unsafe paths, and loose phones", () => {
    const metadataDrift = fixture();
    metadataDrift.metadata = { offeringCategory: "food" };
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(metadataDrift).success).toBe(
      false
    );

    const unknown = fixture();
    unknown.ownerEmail = "attacker@example.com";
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(unknown).success).toBe(false);

    const unsafePath = fixture();
    unsafePath.pagePath = "/visit?email=person@example.com";
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(unsafePath).success).toBe(false);

    const loosePhone = fixture();
    const contact = loosePhone.contact as Record<string, unknown>;
    contact.phone = "504-555-0100";
    expect(rosserGalleryIntakeLeadV1Schema.safeParse(loosePhone).success).toBe(false);
  });

  it("enforces delivery age and future skew while allowing exact replays to bypass it upstream", () => {
    const payload = rosserGalleryIntakeLeadV1Schema.parse(fixture());
    expect(() =>
      assertRosserGalleryIntakeTimestampBounds(
        payload,
        new Date("2026-07-28T20:31:00.000Z")
      )
    ).not.toThrow();
    expect(() =>
      assertRosserGalleryIntakeTimestampBounds(
        payload,
        new Date("2026-08-05T20:31:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      assertRosserGalleryIntakeTimestampBounds(
        payload,
        new Date("2026-07-28T20:20:00.000Z")
      )
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
