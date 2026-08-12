import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import {
  WARM_RECONNECT_ACTIVATION_GATE_IDS,
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
  WARM_RECONNECT_EXCLUDED_ACTIONS,
  WARM_RECONNECT_SCHEMA_VERSION,
} from "@/lib/crm/warm-reconnect-types";

function registrySummary(
  overrides: Partial<PortfolioCrmRegistrySummary> = {}
): PortfolioCrmRegistrySummary {
  return {
    schemaVersion: 1,
    sourceOfTruth: "firestore_portfolio_registry",
    dataClassification: "aggregate_only",
    readOnly: true,
    registry: { accessRole: "owner" },
    totals: {
      people: 1_830,
      contactPoints: 2_097,
      emailContactPoints: 403,
      phoneContactPoints: 1_694,
      sourceRecords: 1_915,
      openConflicts: 0,
    },
    brands: {
      rosser_gallery: 120,
      rt_solutions: 1,
      kgclassy: 0,
      unassigned: 1_709,
    },
    sources: {
      google_people: 1_687,
      google_sheets: 134,
      blinq_csv: 94,
      other: 0,
    },
    permissions: {
      contactPointStates: {
        unknown: 2_097,
        opted_in: 0,
        opted_out: 0,
        reconfirm_required: 0,
        transactional_only: 0,
        other: 0,
      },
      sourceRecordsWithNoPermissionBasis: 1_915,
      permissionEvents: 0,
      suppressions: 0,
    },
    outreach: {
      status: "blocked",
      eligibleContacts: 0,
      reasons: ["Aggregate-only registry never authorizes outreach."],
    },
    freshness: {
      peopleUpdatedAt: "2026-07-21T23:04:01.000Z",
      contactPointsUpdatedAt: "2026-07-21T23:04:04.000Z",
      sourceRecordsUpdatedAt: "2026-07-21T23:04:03.000Z",
      latestUpdatedAt: "2026-07-21T23:04:04.000Z",
      observedAt: "2026-08-12T15:00:00.000Z",
    },
    ...overrides,
  };
}

describe("warm reconnect review-only campaign", () => {
  it("builds exact versioned Marcus-voice copy with one deterministic preview fingerprint", () => {
    const first = buildWarmReconnectCampaignDraft(registrySummary());
    const laterObservation = buildWarmReconnectCampaignDraft(
      registrySummary({
        freshness: {
          ...registrySummary().freshness,
          observedAt: "2026-08-12T17:30:00.000Z",
        },
      })
    );

    expect(first).toMatchObject({
      schemaVersion: WARM_RECONNECT_SCHEMA_VERSION,
      campaignId: WARM_RECONNECT_CAMPAIGN_ID,
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      state: "review_only",
      copy: {
        subject: "A quick hello from Marcus",
        alternateSubject: "Would you like to stay in touch?",
        preheader:
          "A personal note, and an easy way to choose what you’d like to hear about.",
        greeting: "Hi {{first_name | there}},",
        signature: ["Marcus Rosser", "New Orleans, Louisiana"],
      },
      primaryCta: {
        label: "Choose what you’d like to hear about",
        state: "missing",
        enabled: false,
        href: null,
      },
    });
    expect(first.copy.paragraphs).toEqual([
      "I’m reaching out personally because our paths crossed at some point through my art, business, or community work here in New Orleans. I’m bringing those relationships together more thoughtfully, and I wanted to ask before I send you anything else.",
      "If you’d like to stay connected, you’ll be able to choose what you want to hear about. That could be new work and events from Rosser Gallery, practical technology and business updates from RT.Solutions, or an occasional personal note from me.",
    ]);
    expect(first.copy.postCtaParagraphs).toEqual([
      "If now isn’t the right time, no pressure. I’ll respect that.",
      "Thank you for being part of my story in some way. I’m grateful our paths crossed.",
    ]);
    expect(first.copy.plainText).not.toContain("—");
    expect(first.review.previewFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(laterObservation.review.previewFingerprint).toBe(
      first.review.previewFingerprint
    );
    const changedAudience = buildWarmReconnectCampaignDraft(
      registrySummary({
        totals: { ...registrySummary().totals, people: 1_831 },
        brands: { ...registrySummary().brands, unassigned: 1_710 },
      })
    );
    expect(changedAudience.review.previewFingerprint).not.toBe(
      first.review.previewFingerprint
    );
  });

  it("keeps every structured preview essential in the deterministic plain-text version", () => {
    const draft = buildWarmReconnectCampaignDraft(registrySummary());
    const essentials = [
      draft.copy.greeting,
      ...draft.copy.paragraphs,
      draft.primaryCta.label,
      draft.primaryCta.placeholder,
      ...draft.copy.postCtaParagraphs,
      ...draft.copy.signature,
    ];

    for (const essential of essentials) {
      expect(draft.copy.plainText).toContain(essential);
    }
    expect(draft.structuredPreview).toEqual({
      renderer: "component_only",
      rawHtml: false,
      scripts: "none",
      forms: "none",
      tracking: "none",
      remoteContent: "none",
      contentOrder: [
        "preheader",
        "greeting",
        "body",
        "primary_cta",
        "post_cta",
        "signature",
      ],
    });
    expect(JSON.stringify(draft)).not.toMatch(/<html|<script|<form|tracking pixel/i);
  });

  it("grounds artwork for review preview only and leaves email-channel approval missing", () => {
    const draft = buildWarmReconnectCampaignDraft(registrySummary());

    expect(draft.artwork).toEqual({
      usage: "review_preview_only",
      emailChannelApproval: "missing",
      url: "/media/warm-reconnect/glass-braider-black-d53693963446e74b.webp",
      sha256:
        "sha256:d53693963446e74b53ee9d2a4eb617ba251bf3cfe73b686922f2a2f10ebf2ed4",
      sourceRepository: "https://github.com/mrrosser/RNGwebsite",
      sourceAssetPath: "public/art/glass-braider-black-1280.webp",
      sourceAssetCommit: "ba574e78afb280391c93c1ab6d796863c746ec62",
      sourceArtworkPath: "public/art/glass-braider-black.jpg",
      sourceArtworkSha256:
        "sha256:f680db88a56b7b5c80808aaf153577ea431512a5c0e149878054fdbe66a0c243",
      sourceManifestPath: "src/content/mediaManifest.ts",
      rightsApprovalPath: "docs/campaigns/the-braider-atlanta/media-approval.md",
      rightsEvidenceCommit: "69f3e2c255ed988754f866bb645bb7ed0a11e656",
      alt: "Black two-figure braiding sculpture by Marcus Rosser on a reflective glass surface.",
    });
    expect(
      draft.activation.gates.find(
        (gate) => gate.id === "artwork_email_channel_approval"
      )
    ).toMatchObject({ status: "missing", evidenceRef: null });

    const bytes = readFileSync(
      join(
        process.cwd(),
        "public",
        "media",
        "warm-reconnect",
        "glass-braider-black-d53693963446e74b.webp"
      )
    );
    expect(bytes.byteLength).toBe(66_480);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      draft.artwork.sha256
    );
  });

  it("derives held aggregate counts without treating records as recipients", () => {
    const draft = buildWarmReconnectCampaignDraft(registrySummary());

    expect(draft.audience).toEqual({
      people: 1_830,
      unassignedPeople: 1_709,
      emailContactPoints: 403,
      heldEmailContactPoints: 403,
      unknownEmailContactPointsHeld: 403,
      unknownEmailCountIsExact: true,
      sourceRecordsWithNoPermissionBasis: 1_915,
      eligibleContacts: 0,
      eligibilityComputation: "not_available_in_review_only",
      posture: "held_for_permission_and_provenance_review",
    });

    const mixedPermissionSummary = registrySummary();
    mixedPermissionSummary.permissions.contactPointStates.unknown = 2_096;
    mixedPermissionSummary.permissions.contactPointStates.opted_in = 1;
    const mixedDraft = buildWarmReconnectCampaignDraft(mixedPermissionSummary);
    expect(mixedDraft.audience.unknownEmailContactPointsHeld).toBeNull();
    expect(mixedDraft.audience.unknownEmailCountIsExact).toBe(false);
  });

  it("grants the preview fingerprint zero approval or delivery authority", () => {
    const draft = buildWarmReconnectCampaignDraft(registrySummary());

    expect(draft.channels).toEqual({
      email: "preview_only",
      sms: "blocked",
      calls: "blocked",
      social: "blocked",
    });
    expect(draft.authority).toEqual({
      mode: "review_only",
      externalSideEffects: false,
      recipientData: "aggregate_only",
      allowedActions: ["render_review_preview", "inspect_preview_copy"],
      excludedActions: WARM_RECONNECT_EXCLUDED_ACTIONS,
    });
    expect(draft.review).toMatchObject({
      decisionId: null,
      fingerprintAuthority: "none",
      approvalScope: "review_preview_only",
      excludedScope: WARM_RECONNECT_EXCLUDED_ACTIONS,
    });
    expect(draft.activation.gates.map((gate) => gate.id)).toEqual(
      WARM_RECONNECT_ACTIVATION_GATE_IDS
    );
    expect(draft.activation.gates.every((gate) => gate.status === "missing")).toBe(
      true
    );
    expect(JSON.stringify(draft)).not.toMatch(/recipientName|emailAddress|phoneNumber/);
  });

  it("rejects summaries that could imply outreach authority", () => {
    expect(() =>
      buildWarmReconnectCampaignDraft({
        ...registrySummary(),
        readOnly: false,
      } as unknown as PortfolioCrmRegistrySummary)
    ).toThrow(/aggregate-only, read-only, outreach-blocked/);
  });
});
