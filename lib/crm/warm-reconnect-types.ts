import type { PortfolioCrmRegistrySummary } from "@/lib/crm/portfolio-registry-types";

export const WARM_RECONNECT_SCHEMA_VERSION = 1 as const;
export const WARM_RECONNECT_CAMPAIGN_ID = "marcus-warm-reconnect" as const;
export const WARM_RECONNECT_CAMPAIGN_VERSION = "2026-08-12.1" as const;

export const WARM_RECONNECT_ACTIVATION_GATE_IDS = [
  "sender_legal_identity",
  "physical_postal_address",
  "preferences_unsubscribe_endpoint",
  "suppression_ledger",
  "spf_dkim_dmarc",
  "monitored_reply_to",
  "audience_provenance",
  "artwork_email_channel_approval",
] as const;

export const WARM_RECONNECT_EXCLUDED_ACTIONS = [
  "email_send",
  "email_provider_draft_create",
  "sms_send",
  "phone_call",
  "social_profile_lookup",
  "social_direct_message",
  "recipient_enrichment",
  "recipient_export",
] as const;

export type WarmReconnectActivationGateId =
  (typeof WARM_RECONNECT_ACTIVATION_GATE_IDS)[number];
export type WarmReconnectExcludedAction =
  (typeof WARM_RECONNECT_EXCLUDED_ACTIONS)[number];

export interface WarmReconnectActivationGate {
  id: WarmReconnectActivationGateId;
  label: string;
  status: "missing";
  requirement: string;
  evidenceRef: string | null;
}

export interface WarmReconnectCampaignDraft {
  schemaVersion: typeof WARM_RECONNECT_SCHEMA_VERSION;
  campaignId: typeof WARM_RECONNECT_CAMPAIGN_ID;
  campaignVersion: typeof WARM_RECONNECT_CAMPAIGN_VERSION;
  state: "review_only";
  owner: {
    senderName: "Marcus Rosser";
    brands: readonly ["Marcus Rosser", "Rosser Gallery", "RT.Solutions"];
  };
  intent: "warm_reconnect_preferences_invitation";
  source: {
    schemaVersion: PortfolioCrmRegistrySummary["schemaVersion"];
    sourceOfTruth: PortfolioCrmRegistrySummary["sourceOfTruth"];
    dataClassification: "aggregate_only";
    observedAt: string;
  };
  audience: {
    people: number;
    unassignedPeople: number;
    emailContactPoints: number;
    heldEmailContactPoints: number;
    unknownEmailContactPointsHeld: number | null;
    unknownEmailCountIsExact: boolean;
    sourceRecordsWithNoPermissionBasis: number;
    eligibleContacts: 0;
    eligibilityComputation: "not_available_in_review_only";
    posture: "held_for_permission_and_provenance_review";
  };
  channels: {
    email: "preview_only";
    sms: "blocked";
    calls: "blocked";
    social: "blocked";
  };
  copy: {
    subject: "A quick hello from Marcus";
    alternateSubject: "Would you like to stay in touch?";
    preheader: "A personal note, and an easy way to choose what you’d like to hear about.";
    greeting: "Hi {{first_name | there}},";
    paragraphs: readonly [string, string];
    postCtaParagraphs: readonly [string, string];
    signature: readonly ["Marcus Rosser", "New Orleans, Louisiana"];
    plainText: string;
  };
  primaryCta: {
    label: "Choose what you’d like to hear about";
    purpose: "preferences_and_unsubscribe";
    state: "missing";
    enabled: false;
    href: null;
    placeholder: "{{verified_preferences_url}}";
    requirement: string;
  };
  artwork: {
    usage: "review_preview_only";
    emailChannelApproval: "missing";
    url: "/media/warm-reconnect/glass-braider-black-d53693963446e74b.webp";
    sha256: "sha256:d53693963446e74b53ee9d2a4eb617ba251bf3cfe73b686922f2a2f10ebf2ed4";
    sourceRepository: "https://github.com/mrrosser/RNGwebsite";
    sourceAssetPath: "public/art/glass-braider-black-1280.webp";
    sourceAssetCommit: "ba574e78afb280391c93c1ab6d796863c746ec62";
    sourceArtworkPath: "public/art/glass-braider-black.jpg";
    sourceArtworkSha256: "sha256:f680db88a56b7b5c80808aaf153577ea431512a5c0e149878054fdbe66a0c243";
    sourceManifestPath: "src/content/mediaManifest.ts";
    rightsApprovalPath: "docs/campaigns/the-braider-atlanta/media-approval.md";
    rightsEvidenceCommit: "69f3e2c255ed988754f866bb645bb7ed0a11e656";
    alt: "Black two-figure braiding sculpture by Marcus Rosser on a reflective glass surface.";
  };
  structuredPreview: {
    renderer: "component_only";
    rawHtml: false;
    scripts: "none";
    forms: "none";
    tracking: "none";
    remoteContent: "none";
    contentOrder: readonly [
      "preheader",
      "greeting",
      "body",
      "primary_cta",
      "post_cta",
      "signature"
    ];
  };
  activation: {
    status: "blocked";
    gates: WarmReconnectActivationGate[];
  };
  authority: {
    mode: "review_only";
    externalSideEffects: false;
    recipientData: "aggregate_only";
    allowedActions: readonly ["render_review_preview", "inspect_preview_copy"];
    excludedActions: readonly WarmReconnectExcludedAction[];
  };
  review: {
    reviewRoundId: string;
    decisionId: null;
    previewFingerprint: string;
    fingerprintAuthority: "none";
    approvalScope: "review_preview_only";
    excludedScope: readonly WarmReconnectExcludedAction[];
    materialDriftPredicate: string;
  };
}

export interface WarmReconnectReviewResponse {
  schemaVersion: "crm.warm-reconnect-review.v1";
  dataClassification: "aggregate_only";
  readOnly: true;
  registrySummary: PortfolioCrmRegistrySummary;
  campaign: WarmReconnectCampaignDraft;
}
