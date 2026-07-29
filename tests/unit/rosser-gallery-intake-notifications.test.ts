import { describe, expect, it } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/intake-lead.v1.json";
import { rosserGalleryIntakeLeadV1Schema } from "@/lib/crm/rosser-gallery-intake-contract";
import type { RosserGalleryIntakeConfig } from "@/lib/crm/rosser-gallery-intake-config";
import {
  buildIntakeNotificationDrafts,
  computeIntakeNotificationRetryAt,
  nextIntakeNotificationFailureState,
} from "@/lib/crm/rosser-gallery-intake-notifications";

const config: RosserGalleryIntakeConfig = {
  ingestToken: "ingest-token-with-at-least-thirty-two-characters",
  ownerUid: "owner-uid",
  workspaceId: "workspace-id",
  businessUnit: "rosser_nft_gallery",
  customerIdHmacSecret: "customer-id-secret-with-at-least-thirty-two-characters",
  notificationOwnerEmails: {
    rosser_gallery: "mrosser@rossergallery.com",
    rt_solutions: "mrosser@rossergallery.com",
  },
  notificationMaxAttempts: 5,
};

describe("Rosser Gallery intake notification templates", () => {
  it("derives the owner and submitter recipients without caller-selected templates", () => {
    const payload = rosserGalleryIntakeLeadV1Schema.parse(
      structuredClone(fixtureJson)
    );
    const drafts = buildIntakeNotificationDrafts(payload, config);

    expect(drafts.map((draft) => draft.channel)).toEqual([
      "owner_alert",
      "submitter_acknowledgment",
    ]);
    expect(drafts[0]).toMatchObject({
      recipient: "mrosser@rossergallery.com",
      templateVersion: "rosser-gallery-owner-intake-v1",
    });
    expect(drafts[1]).toMatchObject({
      recipient: "community.member@example.com",
      templateVersion: "rosser-gallery-thank-you-v1",
    });
    expect(drafts[1].textBody).toContain("time, patience, and energy");
    expect(drafts[1].textBody).toContain("With appreciation");
    expect(drafts[1].textBody).toContain("reply");
  });

  it("escapes dynamic values in the HTML alternative", () => {
    const raw = structuredClone(fixtureJson) as Record<string, unknown>;
    const contact = raw.contact as Record<string, unknown>;
    contact.name = "Ari <Artist>";
    raw.summary = "A sculpture about roots & memory.";
    const payload = rosserGalleryIntakeLeadV1Schema.parse(raw);
    const [owner, acknowledgment] = buildIntakeNotificationDrafts(payload, config);

    expect(owner.htmlBody).toContain("roots &amp; memory");
    expect(owner.htmlBody).not.toContain("<Artist>");
    expect(acknowledgment.htmlBody).toContain("Ari");
  });

  it("uses bounded exponential retries and a deterministic dead-letter boundary", () => {
    const failedAt = new Date("2026-07-28T21:00:00.000Z");
    expect(computeIntakeNotificationRetryAt(1, failedAt)).toBe(
      "2026-07-28T21:00:30.000Z"
    );
    expect(computeIntakeNotificationRetryAt(4, failedAt)).toBe(
      "2026-07-28T21:04:00.000Z"
    );
    expect(
      nextIntakeNotificationFailureState({
        attemptCount: 4,
        maxAttempts: 5,
        failedAt,
      })
    ).toEqual({ status: "queued", nextAttemptAt: "2026-07-28T21:04:00.000Z" });
    expect(
      nextIntakeNotificationFailureState({
        attemptCount: 5,
        maxAttempts: 5,
        failedAt,
      })
    ).toEqual({ status: "dead_letter", nextAttemptAt: null });
  });
});
