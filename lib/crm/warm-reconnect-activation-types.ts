export const WARM_RECONNECT_ACTIVATION_SCHEMA_VERSION =
  "crm.warm-reconnect-activation.v1" as const;

export const WARM_RECONNECT_PILOT_SCHEMA_VERSION =
  "crm.warm-reconnect-pilot.v1" as const;

export const WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES = [
  {
    businessId: "rosser_nft_gallery",
    profileId: "rosser_gallery_work",
    label: "Rosser Gallery",
  },
  {
    businessId: "rt_solutions",
    profileId: "rt_solutions_work",
    label: "RT.Solutions",
  },
] as const;

export const WARM_RECONNECT_APPROVAL_TTL_HOURS = 24 as const;
export const WARM_RECONNECT_INITIAL_PILOT_SIZE = 5 as const;
export const WARM_RECONNECT_MAX_PILOT_SIZE = 10 as const;

export type WarmReconnectBusinessId =
  (typeof WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES)[number]["businessId"];
export type WarmReconnectGoogleProfileId =
  (typeof WARM_RECONNECT_ALLOWED_GOOGLE_PROFILES)[number]["profileId"];

export type WarmReconnectPermissionState =
  | "unknown"
  | "opted_in"
  | "opted_out"
  | "reconfirm_required"
  | "transactional_only"
  | "other";

export type WarmReconnectCandidateExclusionReason =
  | "malformed_email"
  | "missing_person"
  | "missing_source_evidence"
  | "conflicting_source_ownership"
  | "duplicate_email_across_people"
  | "duplicate_person_contact"
  | "open_import_conflict"
  | "suppressed"
  | "opted_out"
  | "transactional_only"
  | "unsupported_permission_state";

export interface WarmReconnectSourceEvidence {
  evidenceRef: string;
  sourceSystem: string;
  permissionBasis: string;
  observedAt: string | null;
}

export interface WarmReconnectCandidate {
  recipientId: string;
  personId: string;
  contactPointId: string;
  displayName: string;
  email: string;
  emailKey: string;
  permissionState: WarmReconnectPermissionState;
  permissionRemainsExplicit: true;
  sourceEvidence: WarmReconnectSourceEvidence[];
  candidateFingerprint: string;
  reviewStatus: "requires_operator_attestation" | "explicit_permission_review";
}

export interface WarmReconnectExcludedCandidate {
  contactPointId: string;
  personId: string | null;
  reason: WarmReconnectCandidateExclusionReason;
}

export type WarmReconnectRecipientDecision =
  | {
      status: "pending_review";
      decisionId: null;
      decidedAt: null;
      relationshipAttested: false;
      permissionState: WarmReconnectPermissionState;
      sourceEvidenceRefs: readonly string[];
      note: null;
    }
  | {
      status: "eligible_one_time_reconnection";
      decisionId: string;
      decidedAt: string;
      relationshipAttested: true;
      permissionState: WarmReconnectPermissionState;
      sourceEvidenceRefs: readonly string[];
      note: string;
    }
  | {
      status: "excluded";
      decisionId: string;
      decidedAt: string;
      relationshipAttested: false;
      permissionState: WarmReconnectPermissionState;
      sourceEvidenceRefs: readonly string[];
      note: string;
    };

export interface WarmReconnectPilotRecipient {
  recipientId: string;
  personId: string;
  contactPointId: string;
  emailKey: string;
  candidateFingerprint: string;
  sourceEvidence: WarmReconnectSourceEvidence[];
  greetingName: string;
  decision: WarmReconnectRecipientDecision;
}

export interface WarmReconnectPilotRecipientView
  extends WarmReconnectPilotRecipient {
  displayName: string;
  email: string;
}

export type WarmReconnectPilotStatus =
  | "needs_recipient_review"
  | "needs_campaign_approval"
  | "approved"
  | "launch_requested"
  | "stopped"
  | "rejected"
  | "stale";

export type WarmReconnectGateStatus =
  | "missing"
  | "pending_approval"
  | "verified"
  | "failed";

export interface WarmReconnectActivationGateState {
  id:
    | "sender_legal_identity"
    | "physical_postal_address"
    | "preferences_unsubscribe_endpoint"
    | "suppression_ledger"
    | "spf_dkim_dmarc"
    | "monitored_reply_to"
    | "audience_provenance"
    | "artwork_email_channel_approval"
    | "google_profile_connection";
  label: string;
  status: WarmReconnectGateStatus;
  reason: string;
}

export interface WarmReconnectPilotSenderConfiguration {
  senderName: string;
  legalEntity: string;
  fromEmail: string;
  replyTo: string;
  physicalPostalAddress: string;
  businessId: WarmReconnectBusinessId;
  profileId: WarmReconnectGoogleProfileId;
}

export type WarmReconnectPilotSenderInput = Omit<
  WarmReconnectPilotSenderConfiguration,
  "fromEmail"
>;

export interface WarmReconnectPilotApproval {
  approvalId: string;
  decision: "approved";
  approvedAt: string;
  expiresAt: string;
  note: string;
  artifactFingerprint: string;
  audienceFingerprint: string;
  actionFingerprint: string;
  approvalScope: "exact_five_one_time_reconnection_emails";
  excludedScope: readonly [
    "audience_expansion",
    "provider_draft_create",
    "sms_send",
    "phone_call",
    "social_lookup",
    "social_direct_message",
    "ambiguous_outcome_retry"
  ];
}

export interface WarmReconnectPilotAvailableActions {
  canReviewRecipients: boolean;
  canApprove: boolean;
  canLaunch: boolean;
  canStop: boolean;
  launchAuthorizesExactProviderExecution: true;
}

export interface WarmReconnectPilot {
  schemaVersion: typeof WARM_RECONNECT_PILOT_SCHEMA_VERSION;
  pilotId: string;
  workspaceId: string;
  ownerUid: string;
  legacyDncOrgId: string;
  status: WarmReconnectPilotStatus;
  tranche: "initial_5";
  recipientCap: typeof WARM_RECONNECT_INITIAL_PILOT_SIZE;
  campaignPreviewFingerprint: string;
  sender: WarmReconnectPilotSenderConfiguration;
  artworkEmailApproval: {
    attested: true;
    evidenceNote: string;
  };
  preferenceContract: {
    origin: string;
    path: "/preferences";
    version: "warm-reconnect-preferences.v1";
    tokenVersion: "warm-reconnect-preference-token.v1";
  };
  fingerprints: {
    artifactFingerprint: string;
    audienceFingerprint: string;
    actionFingerprint: string;
  };
  recipients: WarmReconnectPilotRecipient[];
  gates: WarmReconnectActivationGateState[];
  approval: WarmReconnectPilotApproval | null;
  availableActions: WarmReconnectPilotAvailableActions;
  createdAt: string;
  updatedAt: string;
  launchRequestedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

export type WarmReconnectPilotView = Omit<
  WarmReconnectPilot,
  "recipients" | "workspaceId" | "ownerUid" | "legacyDncOrgId"
> & {
  recipients: WarmReconnectPilotRecipientView[];
};

export interface WarmReconnectActivationResponse {
  schemaVersion: typeof WARM_RECONNECT_ACTIVATION_SCHEMA_VERSION;
  dataClassification: "authenticated_contact_review";
  providerActions: "none";
  workspace: {
    accessRole: "owner";
  };
  googleProfiles: Array<{
    businessId: WarmReconnectBusinessId;
    profileId: WarmReconnectGoogleProfileId;
    label: string;
    state: "connected" | "not_connected" | "reconnect_required" | "unavailable";
    connected: boolean;
    gmailCapable: boolean;
    accountEmail: string | null;
  }>;
  candidateSummary: {
    eligibleForReview: number;
    excluded: number;
    returned: number;
    truncated: boolean;
  };
  candidates: WarmReconnectCandidate[];
  pilots: WarmReconnectPilotView[];
  constraints: {
    initialPilotSize: typeof WARM_RECONNECT_INITIAL_PILOT_SIZE;
    expandedPilotRange: readonly [6, 10];
    expandedPilotRequiresNewApproval: true;
    approvalTtlHours: typeof WARM_RECONNECT_APPROVAL_TTL_HOURS;
    launchAuthorizesExactProviderExecution: true;
    providerExecutionEnabled: false;
  };
}

export interface CreateWarmReconnectPilotRequest {
  idempotencyKey: string;
  campaignPreviewFingerprint: string;
  tranche: "initial_5";
  recipientCap: typeof WARM_RECONNECT_INITIAL_PILOT_SIZE;
  candidateRecipientIds: [string, string, string, string, string];
  sender: WarmReconnectPilotSenderInput;
  artworkEmailApproval: {
    approvedForThisEmailCampaign: true;
    evidenceNote: string;
  };
}

export type WarmReconnectRecipientDecisionRequest =
  | {
      decision: "attest_relationship";
      expectedCandidateFingerprint: string;
      personallyRecognizedRelationship: true;
      oneTimeReconnectionInvitationOnly: true;
      sourceEvidenceRefs: string[];
      note: string;
    }
  | {
      decision: "exclude";
      expectedCandidateFingerprint: string;
      note: string;
    };

export type WarmReconnectPilotApprovalRequest =
  | {
      decision: "approve";
      expectedArtifactFingerprint: string;
      expectedAudienceFingerprint: string;
      expectedActionFingerprint: string;
      approvalScope: "exact_five_one_time_reconnection_emails";
      confirmations: {
        senderLegalIdentityVerified: true;
        physicalPostalAddressVerified: true;
        preferencesAndUnsubscribeVerified: true;
        suppressionLedgerVerified: true;
        spfDkimDmarcVerified: true;
        replyToMonitored: true;
        artworkApprovedForEmail: true;
        exactAudienceReviewed: true;
      };
      note: string;
    }
  | {
      decision: "reject";
      expectedArtifactFingerprint: string;
      expectedAudienceFingerprint: string;
      expectedActionFingerprint: string;
      note: string;
    };

export interface WarmReconnectPilotLaunchRequest {
  approvalId: string;
  expectedArtifactFingerprint: string;
  expectedAudienceFingerprint: string;
  expectedActionFingerprint: string;
  acknowledgeLaunchAuthorizesExactFiveEmailSend: true;
}

export interface WarmReconnectPilotStopRequest {
  reason: string;
}
