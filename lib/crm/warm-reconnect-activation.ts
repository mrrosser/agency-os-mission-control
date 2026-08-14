import "server-only";

import { ApiError } from "@/lib/api/handler";
import { readBoundedRequestBody } from "@/lib/api/bounded-body";
import { z } from "zod";
import {
  WARM_RECONNECT_APPROVAL_TTL_HOURS,
  WARM_RECONNECT_INITIAL_PILOT_SIZE,
  WARM_RECONNECT_PILOT_SCHEMA_VERSION,
  type CreateWarmReconnectPilotRequest,
  type WarmReconnectActivationGateState,
  type WarmReconnectCandidate,
  type WarmReconnectPilot,
  type WarmReconnectPilotApprovalRequest,
  type WarmReconnectPilotLaunchRequest,
  type WarmReconnectPilotRecipient,
  type WarmReconnectRecipientDecisionRequest,
} from "@/lib/crm/warm-reconnect-activation-types";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import {
  WARM_RECONNECT_EMAIL_RENDERER_VERSION,
  WARM_RECONNECT_RENDERER_CONTRACT_VERSION,
  renderWarmReconnectEmail,
  warmReconnectRendererImplementationFingerprint,
} from "@/lib/crm/warm-reconnect-email-renderer";
import {
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
} from "@/lib/crm/warm-reconnect-types";
import {
  WARM_RECONNECT_MIME_VERSION,
  buildWarmReconnectCampaignMime,
  warmReconnectMimeImplementationFingerprint,
} from "@/lib/google/gmail-campaign";

const APPROVAL_SCOPE = "exact_five_one_time_reconnection_emails" as const;
const EXCLUDED_SCOPE = [
  "audience_expansion",
  "provider_draft_create",
  "sms_send",
  "phone_call",
  "social_lookup",
  "social_direct_message",
  "ambiguous_outcome_retry",
] as const;

export const WARM_RECONNECT_EXECUTION_POLICY = {
  schemaVersion: "warm-reconnect-execution-policy.v1",
  provider: "gmail.users.me.messages.send",
  providerEndpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  maximumClaimsPerInvocation: 1,
  minimumCadenceMs: 60_000,
  capabilityTtlMs: 90 * 24 * 60 * 60 * 1_000,
  inflightReconciliationMs: 5 * 60 * 1_000,
  receiptContract: "crm.warm-reconnect-delivery-receipt.v1",
  invitationLedgerContract: "crm.warm-reconnect-invitation-ledger.v1",
  capabilityContract: "warm-reconnect-preference-token.v1",
  ambiguousProviderOutcome: "stop_without_retry",
  driftBehavior: "stop_before_provider",
  stopBoundary: "refuse_provider_inflight_or_unresolved",
  providerKillSwitchDefault: "disabled",
} as const;

export type WarmReconnectExecutionPolicy = typeof WARM_RECONNECT_EXECUTION_POLICY;

export function warmReconnectInitialPilotLockId(workspaceId: string): string {
  return `wrl_${warmReconnectFingerprint({
    contract: "warm-reconnect-initial-lock.v1",
    workspaceId,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    tranche: "initial_5",
  }).slice(7, 47)}`;
}

export async function parseBoundedWarmReconnectJson<T>(
  request: Request,
  schema: z.ZodSchema<T>,
  maxBytes: number
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new ApiError(415, "Content-Type must be application/json.");
  }
  const raw = await readBoundedRequestBody(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid request body.", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export async function readBoundedWarmReconnectBody(
  request: Request,
  maxBytes: number
): Promise<string> {
  return readBoundedRequestBody(request, maxBytes);
}

const DELIVERY_ARTIFACT_CONTRACT = {
  subject: "A quick hello from Marcus",
  alternateSubject: "Would you like to stay in touch?",
  preheader:
    "A personal note, and an easy way to choose what you’d like to hear about.",
  greeting: "Hi {{first_name | there}},",
  paragraphs: [
    "I’m reaching out personally because our paths crossed at some point through my art, business, or community work here in New Orleans. I’m bringing those relationships together more thoughtfully, and I wanted to ask before I send you anything else.",
    "If you’d like to stay connected, you’ll be able to choose what you want to hear about. That could be new work and events from Rosser Gallery, practical technology and business updates from RT.Solutions, or an occasional personal note from me.",
  ],
  ctaLabel: "Choose what you’d like to hear about",
  postCtaParagraphs: [
    "If now isn’t the right time, no pressure. I’ll respect that.",
    "Thank you for being part of my story in some way. I’m grateful our paths crossed.",
  ],
  signature: ["Marcus Rosser", "New Orleans, Louisiana"],
  artworkSha256:
    "sha256:d53693963446e74b53ee9d2a4eb617ba251bf3cfe73b686922f2a2f10ebf2ed4",
  mimeVersion: WARM_RECONNECT_MIME_VERSION,
  rendererVersion: WARM_RECONNECT_EMAIL_RENDERER_VERSION,
  rendererContractVersion: WARM_RECONNECT_RENDERER_CONTRACT_VERSION,
  unsubscribeHeaderPolicy: {
    visibleLink: true,
    listUnsubscribe: true,
    listUnsubscribePost: "List-Unsubscribe=One-Click",
  },
} as const;

function exactDeliveryTemplateFingerprint(
  pilot: Pick<
    WarmReconnectPilot,
    "sender" | "preferenceContract"
  >
): string {
  const preferenceToken = "p".repeat(43);
  const unsubscribeToken = "u".repeat(43);
  const preferencesUrl = `${pilot.preferenceContract.origin}/preferences#token=${preferenceToken}`;
  const oneClickUnsubscribeUrl =
    `${pilot.preferenceContract.origin}/api/crm/warm-reconnect/unsubscribe/${unsubscribeToken}`;
  const campaign = {
    copy: {
      subject: DELIVERY_ARTIFACT_CONTRACT.subject,
      paragraphs: DELIVERY_ARTIFACT_CONTRACT.paragraphs,
      postCtaParagraphs: DELIVERY_ARTIFACT_CONTRACT.postCtaParagraphs,
    },
    primaryCta: { label: DELIVERY_ARTIFACT_CONTRACT.ctaLabel },
    artwork: {
      url: "/media/warm-reconnect/glass-braider-black-d53693963446e74b.webp",
      alt: "Black two-figure braiding sculpture by Marcus Rosser on a reflective glass surface.",
    },
  } as never;
  const rendered = renderWarmReconnectEmail({
    campaign,
    firstName: "<reviewed first name>",
    senderName: pilot.sender.senderName,
    legalEntity: pilot.sender.legalEntity,
    physicalPostalAddress: pilot.sender.physicalPostalAddress,
    preferencesUrl,
    unsubscribeUrl: oneClickUnsubscribeUrl,
    publicOrigin: pilot.preferenceContract.origin,
  });
  const mime = buildWarmReconnectCampaignMime({
    to: "reviewed-recipient@example.invalid",
    from: pilot.sender.fromEmail,
    senderName: pilot.sender.senderName,
    replyTo: pilot.sender.replyTo,
    subject: rendered.subject,
    plainText: rendered.plainText,
    html: rendered.html,
    messageId: `<warm-reconnect.review-template@${pilot.sender.fromEmail.split("@")[1]}>`,
    preferencesUrl,
    oneClickUnsubscribeUrl,
  });
  return warmReconnectFingerprint({
    contract: "warm-reconnect-rendered-delivery-template.v1",
    rendererContractFingerprint: rendered.contractFingerprint,
    mime,
  });
}

type ApprovalConfirmations = Extract<
  WarmReconnectPilotApprovalRequest,
  { decision: "approve" }
>["confirmations"];

export function computeWarmReconnectPilotFingerprints(
  pilot: Pick<
    WarmReconnectPilot,
    | "pilotId"
    | "workspaceId"
    | "legacyDncOrgId"
    | "campaignPreviewFingerprint"
    | "sender"
    | "artworkEmailApproval"
    | "preferenceContract"
    | "recipients"
    | "recipientCap"
    | "tranche"
  >,
  executionPolicy: WarmReconnectExecutionPolicy = WARM_RECONNECT_EXECUTION_POLICY,
  deliveryImplementation = {
    renderer: warmReconnectRendererImplementationFingerprint(),
    mime: warmReconnectMimeImplementationFingerprint(),
  }
) {
  const artifactFingerprint = warmReconnectFingerprint({
    contract: "warm-reconnect-artifact.v1",
    campaignId: WARM_RECONNECT_CAMPAIGN_ID,
    campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
    campaignPreviewFingerprint: pilot.campaignPreviewFingerprint,
    legacyDncOrgId: pilot.legacyDncOrgId,
    sender: pilot.sender,
    artworkEmailApproval: pilot.artworkEmailApproval,
    preferenceContract: pilot.preferenceContract,
    exactDeliveryArtifact: DELIVERY_ARTIFACT_CONTRACT,
    exactRenderedDeliveryTemplateFingerprint: exactDeliveryTemplateFingerprint(pilot),
    deliveryImplementation,
    fromPolicy: "selected_google_profile_with_exact_sender_display_name.v1",
  });
  const audienceFingerprint = warmReconnectFingerprint({
    contract: "warm-reconnect-audience.v1",
    recipients: [...pilot.recipients]
      .sort((a, b) => a.recipientId.localeCompare(b.recipientId))
      .map((recipient) => ({
        recipientId: recipient.recipientId,
        personId: recipient.personId,
        contactPointId: recipient.contactPointId,
        emailKey: recipient.emailKey,
        candidateFingerprint: recipient.candidateFingerprint,
        greetingName: recipient.greetingName,
        permissionState: recipient.decision.permissionState,
        decisionId: recipient.decision.decisionId,
        decisionStatus: recipient.decision.status,
        relationshipAttested: recipient.decision.relationshipAttested,
        sourceEvidenceRefs: [...recipient.decision.sourceEvidenceRefs].sort(),
      })),
  });
  const actionFingerprint = warmReconnectFingerprint({
    contract: "warm-reconnect-action.v1",
    action: "email_send",
    executionBoundary: "launch_authorizes_exact_claimed_provider_execution.v1",
    workspaceId: pilot.workspaceId,
    legacyDncOrgId: pilot.legacyDncOrgId,
    pilotId: pilot.pilotId,
    googleProfile: {
      businessId: pilot.sender.businessId,
      profileId: pilot.sender.profileId,
    },
    artifactFingerprint,
    audienceFingerprint,
    tranche: pilot.tranche,
    recipientCap: pilot.recipientCap,
    approvalScope: APPROVAL_SCOPE,
    excludedScope: EXCLUDED_SCOPE,
    executionPolicy,
  });
  return { artifactFingerprint, audienceFingerprint, actionFingerprint };
}

export function assertWarmReconnectPilotFingerprints(
  pilot: WarmReconnectPilot
): WarmReconnectPilot["fingerprints"] {
  const current = computeWarmReconnectPilotFingerprints(pilot);
  if (
    current.artifactFingerprint !== pilot.fingerprints.artifactFingerprint ||
    current.audienceFingerprint !== pilot.fingerprints.audienceFingerprint ||
    current.actionFingerprint !== pilot.fingerprints.actionFingerprint
  ) {
    throw new ApiError(409, "The pilot fingerprint contract drifted. Return to review.");
  }
  return current;
}

export function isWarmReconnectRecipientDecisionReplay(input: {
  pilot: WarmReconnectPilot;
  recipientId: string;
  request: WarmReconnectRecipientDecisionRequest;
}): boolean {
  const recipient = input.pilot.recipients.find(
    (candidate) => candidate.recipientId === input.recipientId
  );
  if (
    !recipient ||
    recipient.candidateFingerprint !== input.request.expectedCandidateFingerprint
  ) {
    return false;
  }
  if (input.request.decision === "exclude") {
    return (
      recipient.decision.status === "excluded" &&
      recipient.decision.note === input.request.note
    );
  }
  return (
    recipient.decision.status === "eligible_one_time_reconnection" &&
    recipient.decision.relationshipAttested === true &&
    recipient.decision.note === input.request.note &&
    [...recipient.decision.sourceEvidenceRefs].sort().join("\n") ===
      [...new Set(input.request.sourceEvidenceRefs)].sort().join("\n")
  );
}

export function isWarmReconnectPilotApprovalReplay(input: {
  pilot: WarmReconnectPilot;
  request: WarmReconnectPilotApprovalRequest;
  now?: Date;
}): boolean {
  return (
    input.request.decision === "approve" &&
    Boolean(
      input.pilot.approval &&
        Date.parse(input.pilot.approval.expiresAt) > (input.now || new Date()).getTime() &&
        input.pilot.approval.decision === "approved" &&
        input.pilot.approval.note === input.request.note &&
        input.pilot.approval.artifactFingerprint ===
          input.request.expectedArtifactFingerprint &&
        input.pilot.approval.audienceFingerprint ===
          input.request.expectedAudienceFingerprint &&
        input.pilot.approval.actionFingerprint ===
          input.request.expectedActionFingerprint
    )
  );
}

export function isWarmReconnectPilotLaunchReplay(input: {
  pilot: WarmReconnectPilot;
  request: WarmReconnectPilotLaunchRequest;
}): boolean {
  return (
    input.pilot.status === "launch_requested" &&
    input.pilot.approval?.approvalId === input.request.approvalId &&
    input.pilot.fingerprints.artifactFingerprint ===
      input.request.expectedArtifactFingerprint &&
    input.pilot.fingerprints.audienceFingerprint ===
      input.request.expectedAudienceFingerprint &&
    input.pilot.fingerprints.actionFingerprint ===
      input.request.expectedActionFingerprint
  );
}

export function isWarmReconnectPilotStopReplay(
  pilot: WarmReconnectPilot,
  reason: string
): boolean {
  return pilot.status === "stopped" && pilot.stopReason === reason;
}

export function assertWarmReconnectStopBoundary(
  executorState: unknown,
  activeReceipt: unknown
): void {
  if (!executorState || typeof executorState !== "object") return;
  const state = executorState as Record<string, unknown>;
  const activeReceiptId =
    typeof state.activeReceiptId === "string" ? state.activeReceiptId : null;
  if (!activeReceiptId) return;
  if (!activeReceipt || typeof activeReceipt !== "object") {
    throw new ApiError(409, "The active delivery must be reconciled before stop can be confirmed.");
  }
  const receipt = activeReceipt as Record<string, unknown>;
  if (receipt.receiptId !== activeReceiptId) {
    throw new ApiError(409, "The active delivery must be reconciled before stop can be confirmed.");
  }
  if (!['claimed', 'capabilities_prepared'].includes(String(receipt.status || ''))) {
    throw new ApiError(
      409,
      "A provider delivery is already in flight or unresolved; stop cannot be confirmed yet."
    );
  }
}

export function canReleaseWarmReconnectInitialPilotLock(input: {
  executorState: unknown;
  receipts: readonly unknown[];
}): boolean {
  const state =
    input.executorState && typeof input.executorState === "object"
      ? (input.executorState as Record<string, unknown>)
      : null;
  if (state) {
    const sentCount = Number(state.sentCount ?? 0);
    const lastProviderAttemptAtMs = state.lastProviderAttemptAtMs;
    if (
      !Number.isSafeInteger(sentCount) ||
      sentCount !== 0 ||
      (lastProviderAttemptAtMs !== null && lastProviderAttemptAtMs !== undefined)
    ) {
      return false;
    }
  }
  if (input.receipts.length > WARM_RECONNECT_INITIAL_PILOT_SIZE) return false;
  const activeReceiptId =
    state && typeof state.activeReceiptId === "string" ? state.activeReceiptId : null;
  return input.receipts.every((value) => {
    if (!value || typeof value !== "object") return false;
    const receipt = value as Record<string, unknown>;
    const status = String(receipt.status || "");
    if (
      receipt.providerStartedAtMs !== null &&
      receipt.providerStartedAtMs !== undefined
    ) {
      return false;
    }
    if (status === "stopped_before_provider") return true;
    if (!["claimed", "capabilities_prepared"].includes(status)) return false;
    return typeof receipt.receiptId === "string" && receipt.receiptId === activeReceiptId;
  });
}

function allRecipientsAttested(pilot: WarmReconnectPilot): boolean {
  return (
    pilot.recipients.length === WARM_RECONNECT_INITIAL_PILOT_SIZE &&
    pilot.recipients.every(
      (recipient) =>
        recipient.decision.status === "eligible_one_time_reconnection" &&
        recipient.decision.relationshipAttested === true &&
        recipient.decision.sourceEvidenceRefs.length > 0
    )
  );
}

function buildGates(input: {
  pilot: Pick<WarmReconnectPilot, "sender" | "artworkEmailApproval" | "recipients">;
  googleReady: boolean;
  confirmations?: ApprovalConfirmations;
}): WarmReconnectActivationGateState[] {
  const confirmed = input.confirmations;
  const audienceReady =
    input.pilot.recipients.length === WARM_RECONNECT_INITIAL_PILOT_SIZE &&
    input.pilot.recipients.every(
      (recipient) => recipient.decision.status === "eligible_one_time_reconnection"
    );
  const pending = (ready: boolean): WarmReconnectActivationGateState["status"] =>
    ready ? "pending_approval" : "missing";

  return [
    {
      id: "sender_legal_identity",
      label: "Sender legal identity",
      status: confirmed?.senderLegalIdentityVerified
        ? "verified"
        : pending(Boolean(input.pilot.sender.senderName && input.pilot.sender.legalEntity)),
      reason: confirmed?.senderLegalIdentityVerified
        ? "Approved for this exact artifact."
        : "Confirm the displayed sender and legal entity during campaign approval.",
    },
    {
      id: "physical_postal_address",
      label: "Physical postal address",
      status: confirmed?.physicalPostalAddressVerified
        ? "verified"
        : pending(Boolean(input.pilot.sender.physicalPostalAddress)),
      reason: confirmed?.physicalPostalAddressVerified
        ? "Approved for this exact artifact."
        : "Confirm the physical postal address during campaign approval.",
    },
    {
      id: "preferences_unsubscribe_endpoint",
      label: "Preferences and unsubscribe endpoint",
      status: confirmed?.preferencesAndUnsubscribeVerified
        ? "verified"
        : "pending_approval",
      reason: confirmed?.preferencesAndUnsubscribeVerified
        ? "The v1 preference contract is approved for this pilot."
        : "Review the public preference and immediate unsubscribe contract.",
    },
    {
      id: "suppression_ledger",
      label: "Suppression ledger",
      status: confirmed?.suppressionLedgerVerified ? "verified" : "pending_approval",
      reason: confirmed?.suppressionLedgerVerified
        ? "The canonical suppression check is approved for this pilot."
        : "Confirm suppression checks before approval.",
    },
    {
      id: "spf_dkim_dmarc",
      label: "SPF, DKIM, and DMARC",
      status: confirmed?.spfDkimDmarcVerified ? "verified" : "missing",
      reason: confirmed?.spfDkimDmarcVerified
        ? "Sender authentication was attested during approval."
        : "Verify sender-domain SPF, DKIM, and DMARC before approval.",
    },
    {
      id: "monitored_reply_to",
      label: "Monitored reply-to",
      status: confirmed?.replyToMonitored
        ? "verified"
        : pending(Boolean(input.pilot.sender.replyTo)),
      reason: confirmed?.replyToMonitored
        ? "The reply-to mailbox was attested as monitored."
        : "Confirm that the reply-to mailbox is monitored.",
    },
    {
      id: "audience_provenance",
      label: "Audience provenance",
      status: confirmed?.exactAudienceReviewed
        ? "verified"
        : audienceReady
          ? "pending_approval"
          : "missing",
      reason: confirmed?.exactAudienceReviewed
        ? "All five relationship attestations are bound to this audience fingerprint."
        : audienceReady
          ? "Review and approve the exact five-person audience."
          : "Each of the five people needs an individual relationship decision.",
    },
    {
      id: "artwork_email_channel_approval",
      label: "Artwork email-channel approval",
      status: confirmed?.artworkApprovedForEmail
        ? "verified"
        : pending(input.pilot.artworkEmailApproval.attested),
      reason: confirmed?.artworkApprovedForEmail
        ? "The artwork is approved for this exact email artifact."
        : "Confirm the artwork's use in this exact email campaign.",
    },
    {
      id: "google_profile_connection",
      label: "Google sending profile",
      status: input.googleReady ? "verified" : "missing",
      reason: input.googleReady
        ? "The selected profile is connected with Gmail capability."
        : "Connect the selected Google profile with Gmail capability.",
    },
  ];
}

export function isWarmReconnectApprovalCurrent(
  pilot: WarmReconnectPilot,
  now: Date = new Date()
): boolean {
  return Boolean(
    pilot.approval &&
      Date.parse(pilot.approval.expiresAt) > now.getTime() &&
      pilot.approval.artifactFingerprint === pilot.fingerprints.artifactFingerprint &&
      pilot.approval.audienceFingerprint === pilot.fingerprints.audienceFingerprint &&
      pilot.approval.actionFingerprint === pilot.fingerprints.actionFingerprint
  );
}

export function materializeWarmReconnectPilot(
  pilot: WarmReconnectPilot,
  options: { googleReady: boolean; now?: Date }
): WarmReconnectPilot {
  assertWarmReconnectPilotFingerprints(pilot);
  const now = options.now || new Date();
  const approvalCurrent = isWarmReconnectApprovalCurrent(pilot, now);
  const canReviewRecipients =
    pilot.status === "needs_recipient_review" || pilot.status === "needs_campaign_approval";
  const canApprove =
    !["launch_requested", "stopped", "rejected"].includes(pilot.status) &&
    allRecipientsAttested(pilot) &&
    options.googleReady &&
    (!pilot.approval || !approvalCurrent);
  const canLaunch =
    pilot.status === "approved" &&
    approvalCurrent &&
    options.googleReady &&
    pilot.gates.every((gate) => gate.status === "verified");
  const canStop = !["stopped", "rejected"].includes(pilot.status);
  return {
    ...pilot,
    availableActions: {
      canReviewRecipients,
      canApprove,
      canLaunch,
      canStop,
      launchAuthorizesExactProviderExecution: true,
    },
  };
}

export function createWarmReconnectPilot(input: {
  pilotId: string;
  workspaceId: string;
  ownerUid: string;
  request: CreateWarmReconnectPilotRequest;
  candidates: WarmReconnectCandidate[];
  now?: Date;
  googleReady: boolean;
  preferenceOrigin: string;
  fromEmail: string;
  accountId: string;
  legacyDncOrgId: string;
}): WarmReconnectPilot {
  if (
    input.request.tranche !== "initial_5" ||
    input.request.recipientCap !== WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    input.candidates.length !== WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    new Set(input.candidates.map((candidate) => candidate.recipientId)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    new Set(input.candidates.map((candidate) => candidate.personId)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    new Set(input.candidates.map((candidate) => candidate.emailKey)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE
  ) {
    throw new ApiError(409, "The first pilot requires exactly five distinct people and emails.");
  }

  const expectedProfile =
    input.request.sender.businessId === "rosser_nft_gallery"
      ? "rosser_gallery_work"
      : input.request.sender.businessId === "rt_solutions"
        ? "rt_solutions_work"
        : null;
  if (!expectedProfile || input.request.sender.profileId !== expectedProfile) {
    throw new ApiError(400, "The Google business and profile selection do not match.");
  }

  const now = (input.now || new Date()).toISOString();
  const recipients: WarmReconnectPilotRecipient[] = input.candidates.map((candidate) => ({
    recipientId: candidate.recipientId,
    personId: candidate.personId,
    contactPointId: candidate.contactPointId,
    emailKey: candidate.emailKey,
    candidateFingerprint: candidate.candidateFingerprint,
    sourceEvidence: candidate.sourceEvidence,
    // Freeze bounded personalization inside the reviewed audience. The
    // executor never re-reads a mutable CRM name for delivery content.
    greetingName:
      String(candidate.displayName || "")
        .trim()
        .split(/\s+/)[0]
        ?.replace(/[\0\r\n<>]/g, "")
        .slice(0, 80) || "there",
    decision: {
      status: "pending_review",
      decisionId: null,
      decidedAt: null,
      relationshipAttested: false,
      permissionState: candidate.permissionState,
      sourceEvidenceRefs: candidate.sourceEvidence.map((evidence) => evidence.evidenceRef),
      note: null,
    },
  }));
  const base = {
    schemaVersion: WARM_RECONNECT_PILOT_SCHEMA_VERSION,
    pilotId: input.pilotId,
    workspaceId: input.workspaceId,
    ownerUid: input.ownerUid,
    legacyDncOrgId: input.legacyDncOrgId,
    status: "needs_recipient_review" as const,
    tranche: "initial_5" as const,
    recipientCap: WARM_RECONNECT_INITIAL_PILOT_SIZE,
    campaignPreviewFingerprint: input.request.campaignPreviewFingerprint,
    sender: {
      ...input.request.sender,
      fromEmail: input.fromEmail,
      accountId: input.accountId,
    },
    artworkEmailApproval: {
      attested: true as const,
      evidenceNote: input.request.artworkEmailApproval.evidenceNote,
    },
    preferenceContract: {
      origin: input.preferenceOrigin,
      path: "/preferences" as const,
      version: "warm-reconnect-preferences.v1" as const,
      tokenVersion: "warm-reconnect-preference-token.v1" as const,
    },
    recipients,
    approval: null,
    createdAt: now,
    updatedAt: now,
    launchRequestedAt: null,
    stoppedAt: null,
    stopReason: null,
  };
  const fingerprints = computeWarmReconnectPilotFingerprints(base);
  const pilot: WarmReconnectPilot = {
    ...base,
    fingerprints,
    gates: buildGates({ pilot: base, googleReady: input.googleReady }),
    availableActions: {
      canReviewRecipients: true,
      canApprove: false,
      canLaunch: false,
      canStop: true,
      launchAuthorizesExactProviderExecution: true,
    },
  };
  return materializeWarmReconnectPilot(pilot, { googleReady: input.googleReady, now: new Date(now) });
}

export function decideWarmReconnectRecipient(input: {
  pilot: WarmReconnectPilot;
  recipientId: string;
  decisionId: string;
  request: WarmReconnectRecipientDecisionRequest;
  now?: Date;
  googleReady: boolean;
}): WarmReconnectPilot {
  if (!["needs_recipient_review", "needs_campaign_approval"].includes(input.pilot.status)) {
    throw new ApiError(409, "Recipient decisions are closed for this pilot.");
  }
  const index = input.pilot.recipients.findIndex(
    (recipient) => recipient.recipientId === input.recipientId
  );
  if (index < 0) throw new ApiError(404, "Pilot recipient not found.");
  const recipient = input.pilot.recipients[index];
  if (recipient.candidateFingerprint !== input.request.expectedCandidateFingerprint) {
    throw new ApiError(409, "The recipient evidence changed. Reload the pilot before deciding.");
  }
  const now = (input.now || new Date()).toISOString();
  let decision: WarmReconnectPilotRecipient["decision"];
  if (input.request.decision === "attest_relationship") {
    const allowedEvidence = new Set(
      recipient.sourceEvidence.map((evidence) => evidence.evidenceRef)
    );
    const submitted = [...new Set(input.request.sourceEvidenceRefs)].sort();
    if (submitted.length === 0 || submitted.some((ref) => !allowedEvidence.has(ref))) {
      throw new ApiError(400, "Relationship attestation requires existing source evidence.");
    }
    decision = {
      status: "eligible_one_time_reconnection",
      decisionId: input.decisionId,
      decidedAt: now,
      relationshipAttested: true,
      // An operator attestation authorizes only this reviewed invitation. It
      // never rewrites unknown permission as an opt-in.
      permissionState: recipient.decision.permissionState,
      sourceEvidenceRefs: submitted,
      note: input.request.note,
    };
  } else {
    decision = {
      status: "excluded",
      decisionId: input.decisionId,
      decidedAt: now,
      relationshipAttested: false,
      permissionState: recipient.decision.permissionState,
      sourceEvidenceRefs: recipient.decision.sourceEvidenceRefs,
      note: input.request.note,
    };
  }

  const recipients = [...input.pilot.recipients];
  recipients[index] = { ...recipient, decision };
  const nextBase: WarmReconnectPilot = {
    ...input.pilot,
    recipients,
    approval: null,
    updatedAt: now,
    status:
      recipients.every((value) => value.decision.status === "eligible_one_time_reconnection")
        ? "needs_campaign_approval"
        : "needs_recipient_review",
  };
  const fingerprints = computeWarmReconnectPilotFingerprints(nextBase);
  const next = {
    ...nextBase,
    fingerprints,
    gates: buildGates({ pilot: nextBase, googleReady: input.googleReady }),
  };
  return materializeWarmReconnectPilot(next, {
    googleReady: input.googleReady,
    now: new Date(now),
  });
}

function assertExpectedFingerprints(
  pilot: WarmReconnectPilot,
  expected: {
    expectedArtifactFingerprint: string;
    expectedAudienceFingerprint: string;
    expectedActionFingerprint: string;
  }
) {
  if (
    pilot.fingerprints.artifactFingerprint !== expected.expectedArtifactFingerprint ||
    pilot.fingerprints.audienceFingerprint !== expected.expectedAudienceFingerprint ||
    pilot.fingerprints.actionFingerprint !== expected.expectedActionFingerprint
  ) {
    throw new ApiError(409, "The reviewed campaign changed. Reload and review the new fingerprints.");
  }
}

export function decideWarmReconnectPilotApproval(input: {
  pilot: WarmReconnectPilot;
  approvalId: string;
  request: WarmReconnectPilotApprovalRequest;
  now?: Date;
  googleReady: boolean;
}): WarmReconnectPilot {
  assertExpectedFingerprints(input.pilot, input.request);
  if (["launch_requested", "stopped", "rejected"].includes(input.pilot.status)) {
    throw new ApiError(409, "Campaign approval is closed for this pilot.");
  }
  const nowDate = input.now || new Date();
  const now = nowDate.toISOString();

  if (input.request.decision === "reject") {
    return materializeWarmReconnectPilot(
      {
        ...input.pilot,
        status: "rejected",
        approval: null,
        updatedAt: now,
      },
      { googleReady: input.googleReady, now: nowDate }
    );
  }
  if (!allRecipientsAttested(input.pilot)) {
    throw new ApiError(409, "All five recipient relationships must be attested first.");
  }
  if (!input.googleReady) {
    throw new ApiError(409, "The selected Google profile is not Gmail-ready.");
  }
  const gates = buildGates({
    pilot: input.pilot,
    googleReady: true,
    confirmations: input.request.confirmations,
  });
  if (gates.some((gate) => gate.status !== "verified")) {
    throw new ApiError(409, "Every activation gate must be verified in this approval.");
  }
  const expiresAt = new Date(
    nowDate.getTime() + WARM_RECONNECT_APPROVAL_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();
  const next: WarmReconnectPilot = {
    ...input.pilot,
    status: "approved",
    gates,
    approval: {
      approvalId: input.approvalId,
      decision: "approved",
      approvedAt: now,
      expiresAt,
      note: input.request.note,
      ...input.pilot.fingerprints,
      approvalScope: APPROVAL_SCOPE,
      excludedScope: EXCLUDED_SCOPE,
    },
    updatedAt: now,
  };
  return materializeWarmReconnectPilot(next, { googleReady: true, now: nowDate });
}

export function requestWarmReconnectPilotLaunch(input: {
  pilot: WarmReconnectPilot;
  request: WarmReconnectPilotLaunchRequest;
  now?: Date;
  googleReady: boolean;
}): WarmReconnectPilot {
  assertExpectedFingerprints(input.pilot, input.request);
  const nowDate = input.now || new Date();
  if (input.pilot.status === "launch_requested") {
    return materializeWarmReconnectPilot(input.pilot, {
      googleReady: input.googleReady,
      now: nowDate,
    });
  }
  if (input.pilot.status !== "approved" || !input.pilot.approval) {
    throw new ApiError(409, "This pilot does not have a current approval.");
  }
  if (input.pilot.approval.approvalId !== input.request.approvalId) {
    throw new ApiError(409, "The launch request does not match the approved decision.");
  }
  if (!input.googleReady || !isWarmReconnectApprovalCurrent(input.pilot, nowDate)) {
    throw new ApiError(409, "Approval or Google readiness changed. Return to review.");
  }
  if (input.pilot.gates.some((gate) => gate.status !== "verified")) {
    throw new ApiError(409, "Every activation gate must remain verified.");
  }
  const now = nowDate.toISOString();
  // This is deliberately the terminal state for this slice. No provider is
  // imported or invoked here; a separately reviewed executor must claim it.
  return materializeWarmReconnectPilot(
    {
      ...input.pilot,
      status: "launch_requested",
      launchRequestedAt: now,
      updatedAt: now,
    },
    { googleReady: input.googleReady, now: nowDate }
  );
}

export function stopWarmReconnectPilot(input: {
  pilot: WarmReconnectPilot;
  reason: string;
  now?: Date;
  googleReady: boolean;
}): WarmReconnectPilot {
  if (input.pilot.status === "rejected") {
    throw new ApiError(409, "A rejected pilot is already terminal.");
  }
  if (input.pilot.status === "stopped") {
    return materializeWarmReconnectPilot(input.pilot, {
      googleReady: input.googleReady,
      now: input.now,
    });
  }
  const nowDate = input.now || new Date();
  const now = nowDate.toISOString();
  return materializeWarmReconnectPilot(
    {
      ...input.pilot,
      status: "stopped",
      approval: null,
      stoppedAt: now,
      stopReason: input.reason,
      updatedAt: now,
    },
    { googleReady: input.googleReady, now: nowDate }
  );
}
