import "server-only";

import { createHash } from "node:crypto";
import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";
import {
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
  WARM_RECONNECT_EXCLUDED_ACTIONS,
  WARM_RECONNECT_SCHEMA_VERSION,
  type WarmReconnectActivationGate,
  type WarmReconnectCampaignDraft,
} from "@/lib/crm/warm-reconnect-types";

const COPY = {
  subject: "A quick hello from Marcus",
  alternateSubject: "Would you like to stay in touch?",
  preheader:
    "A personal note, and an easy way to choose what you’d like to hear about.",
  greeting: "Hi {{first_name | there}},",
  paragraphs: [
    "I’m reaching out personally because our paths crossed at some point through my art, business, or community work here in New Orleans. I’m bringing those relationships together more thoughtfully, and I wanted to ask before I send you anything else.",
    "If you’d like to stay connected, you’ll be able to choose what you want to hear about. That could be new work and events from Rosser Gallery, practical technology and business updates from RT.Solutions, or an occasional personal note from me.",
  ] as const,
  postCtaParagraphs: [
    "If now isn’t the right time, no pressure. I’ll respect that.",
    "Thank you for being part of my story in some way. I’m grateful our paths crossed.",
  ] as const,
  signature: ["Marcus Rosser", "New Orleans, Louisiana"] as const,
} as const;

const PRIMARY_CTA = {
  label: "Choose what you’d like to hear about",
  purpose: "preferences_and_unsubscribe",
  state: "missing",
  enabled: false,
  href: null,
  placeholder: "{{verified_preferences_url}}",
  requirement:
    "Verify a public HTTPS endpoint that saves preferences and accepts immediate unsubscribe requests before activation.",
} as const;

const ARTWORK = {
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
} as const;

const STRUCTURED_PREVIEW = {
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
} as const;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function buildPlainText(): string {
  return [
    COPY.greeting,
    ...COPY.paragraphs,
    `${PRIMARY_CTA.label}\n${PRIMARY_CTA.placeholder}`,
    ...COPY.postCtaParagraphs,
    COPY.signature.join("\n"),
  ].join("\n\n");
}

function buildActivationGates(): WarmReconnectActivationGate[] {
  return [
    {
      id: "sender_legal_identity",
      label: "Sender legal identity",
      status: "missing",
      requirement: "Verify the legal sender identity displayed in every delivered message.",
      evidenceRef: null,
    },
    {
      id: "physical_postal_address",
      label: "Physical postal address",
      status: "missing",
      requirement: "Verify the physical postal address required in delivered email.",
      evidenceRef: null,
    },
    {
      id: "preferences_unsubscribe_endpoint",
      label: "Preferences and unsubscribe endpoint",
      status: "missing",
      requirement:
        "Verify a public HTTPS page that saves preferences and accepts immediate unsubscribe requests.",
      evidenceRef: null,
    },
    {
      id: "suppression_ledger",
      label: "Suppression ledger",
      status: "missing",
      requirement:
        "Verify a durable suppression ledger is checked before every audience export or send.",
      evidenceRef: null,
    },
    {
      id: "spf_dkim_dmarc",
      label: "SPF, DKIM, and DMARC",
      status: "missing",
      requirement: "Verify authenticated sender-domain alignment for SPF, DKIM, and DMARC.",
      evidenceRef: null,
    },
    {
      id: "monitored_reply_to",
      label: "Monitored reply-to",
      status: "missing",
      requirement: "Verify a monitored reply-to mailbox and owner response process.",
      evidenceRef: null,
    },
    {
      id: "audience_provenance",
      label: "Audience provenance",
      status: "missing",
      requirement:
        "Reconcile each recipient’s relationship, brand fit, channel permission, source evidence, and suppression state.",
      evidenceRef: null,
    },
    {
      id: "artwork_email_channel_approval",
      label: "Artwork email-channel approval",
      status: "missing",
      requirement:
        "Approve the rights-cleared review artwork for this exact email channel and campaign before activation.",
      evidenceRef: null,
    },
  ];
}

export function buildWarmReconnectCampaignDraft(
  summary: PortfolioCrmRegistrySummary
): WarmReconnectCampaignDraft {
  if (
    summary.dataClassification !== "aggregate_only" ||
    summary.readOnly !== true ||
    summary.outreach.status !== "blocked" ||
    summary.outreach.eligibleContacts !== 0
  ) {
    throw new Error(
      "Warm reconnect preview requires an aggregate-only, read-only, outreach-blocked registry summary."
    );
  }

  const allContactPointsUnknown =
    summary.permissions.contactPointStates.unknown === summary.totals.contactPoints;
  const plainText = buildPlainText();
  const audience = {
    people: summary.totals.people,
    unassignedPeople: summary.brands.unassigned,
    emailContactPoints: summary.totals.emailContactPoints,
    heldEmailContactPoints: summary.totals.emailContactPoints,
    unknownEmailContactPointsHeld: allContactPointsUnknown
      ? summary.totals.emailContactPoints
      : null,
    unknownEmailCountIsExact: allContactPointsUnknown,
    sourceRecordsWithNoPermissionBasis:
      summary.permissions.sourceRecordsWithNoPermissionBasis,
    eligibleContacts: 0 as const,
    eligibilityComputation: "not_available_in_review_only" as const,
    posture: "held_for_permission_and_provenance_review" as const,
  };
  const channels = {
    email: "preview_only" as const,
    sms: "blocked" as const,
    calls: "blocked" as const,
    social: "blocked" as const,
  };
  const authority = {
    mode: "review_only" as const,
    externalSideEffects: false as const,
    recipientData: "aggregate_only" as const,
    allowedActions: ["render_review_preview", "inspect_preview_copy"] as const,
    excludedActions: WARM_RECONNECT_EXCLUDED_ACTIONS,
  };
  const owner = {
    senderName: "Marcus Rosser" as const,
    brands: ["Marcus Rosser", "Rosser Gallery", "RT.Solutions"] as const,
  };
  const intent = "warm_reconnect_preferences_invitation" as const;
  const reviewScope = {
    reviewRoundId: `${WARM_RECONNECT_CAMPAIGN_ID}:${WARM_RECONNECT_CAMPAIGN_VERSION}:round-1`,
    approvalScope: "review_preview_only" as const,
    excludedScope: WARM_RECONNECT_EXCLUDED_ACTIONS,
  };
  const previewFingerprint = fingerprint({
    schemaVersion: WARM_RECONNECT_SCHEMA_VERSION,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    copy: { ...COPY, plainText },
    primaryCta: PRIMARY_CTA,
    artwork: ARTWORK,
    structuredPreview: STRUCTURED_PREVIEW,
    activationGates: buildActivationGates(),
    sourceContract: {
      schemaVersion: summary.schemaVersion,
      sourceOfTruth: summary.sourceOfTruth,
      dataClassification: summary.dataClassification,
    },
    audience,
    channels,
    authority,
    owner,
    intent,
    reviewScope,
  });

  return {
    schemaVersion: WARM_RECONNECT_SCHEMA_VERSION,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    state: "review_only",
    owner,
    intent,
    source: {
      schemaVersion: summary.schemaVersion,
      sourceOfTruth: summary.sourceOfTruth,
      dataClassification: "aggregate_only",
      observedAt: summary.freshness.observedAt,
    },
    audience,
    channels,
    copy: { ...COPY, plainText },
    primaryCta: PRIMARY_CTA,
    artwork: ARTWORK,
    structuredPreview: STRUCTURED_PREVIEW,
    activation: {
      status: "blocked",
      gates: buildActivationGates(),
    },
    authority,
    review: {
      reviewRoundId: reviewScope.reviewRoundId,
      decisionId: null,
      previewFingerprint,
      fingerprintAuthority: "none",
      approvalScope: reviewScope.approvalScope,
      excludedScope: reviewScope.excludedScope,
      materialDriftPredicate:
        "Any change to campaign version, copy, CTA destination, artwork metadata, structured preview, activation gates, audience posture, channel posture, or excluded scope requires a new preview fingerprint and review.",
    },
  };
}
