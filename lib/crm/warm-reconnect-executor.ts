import "server-only";

import { createHash } from "node:crypto";
import {
  FieldValue,
  type DocumentData,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import {
  WARM_RECONNECT_INITIAL_PILOT_SIZE,
  WARM_RECONNECT_PILOT_SCHEMA_VERSION,
  type WarmReconnectPilot,
  type WarmReconnectPilotRecipient,
  type WarmReconnectSourceEvidence,
} from "@/lib/crm/warm-reconnect-activation-types";
import {
  assertWarmReconnectPilotFingerprints,
  isWarmReconnectApprovalCurrent,
  WARM_RECONNECT_EXECUTION_POLICY,
  warmReconnectInitialPilotLockId,
} from "@/lib/crm/warm-reconnect-activation";
import {
  normalizeWarmReconnectEmail,
  warmReconnectEmailKey,
  warmReconnectFingerprint,
} from "@/lib/crm/warm-reconnect-dedupe";
import { renderWarmReconnectEmail } from "@/lib/crm/warm-reconnect-email-renderer";
import {
  WARM_RECONNECT_INVITATION_LEDGER_COLLECTION,
  parseWarmReconnectInvitationLedgerDocument,
  reconcileWarmReconnectInvitationReservation,
  reconcileWarmReconnectInvitationTransition,
  warmReconnectInvitationBindingMatches,
  warmReconnectInvitationReservationBindingForPilot,
  type WarmReconnectInvitationLedgerDocument,
  type WarmReconnectInvitationLedgerStatus,
  type WarmReconnectInvitationReservationBinding,
} from "@/lib/crm/warm-reconnect-invitation-ledger";
import {
  digestWarmReconnectToken,
  issueWarmReconnectPreferenceCapabilities,
} from "@/lib/crm/warm-reconnect-preferences";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";
import {
  WARM_RECONNECT_CAMPAIGN_ID,
  WARM_RECONNECT_CAMPAIGN_VERSION,
} from "@/lib/crm/warm-reconnect-types";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveGoogleBusinessProfileContext } from "@/lib/google/business-profiles";
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
import {
  getAccessTokenForUser,
  isGoogleTokenScopeBoundedForPreset,
} from "@/lib/google/oauth";
import { sendWarmReconnectCampaignEmail } from "@/lib/google/gmail-campaign-sender";
import {
  computeDncEntryId,
  expandDomainCandidates,
} from "@/lib/outreach/dnc";
import type { Logger } from "@/lib/logging";

export const WARM_RECONNECT_PROVIDER_SEND_FLAG =
  "WARM_RECONNECT_PROVIDER_SEND_ENABLED" as const;
export const WARM_RECONNECT_MIN_CADENCE_MS =
  WARM_RECONNECT_EXECUTION_POLICY.minimumCadenceMs;
export const WARM_RECONNECT_CAPABILITY_TTL_MS =
  WARM_RECONNECT_EXECUTION_POLICY.capabilityTtlMs;
export const WARM_RECONNECT_INFLIGHT_RECONCILIATION_MS =
  WARM_RECONNECT_EXECUTION_POLICY.inflightReconciliationMs;
export const WARM_RECONNECT_MAX_CLAIMS_PER_INVOCATION =
  WARM_RECONNECT_EXECUTION_POLICY.maximumClaimsPerInvocation;

const COLLECTIONS = {
  pilots: "crm_warm_reconnect_pilots",
  people: "crm_people",
  contactPoints: "crm_contact_points",
  sourceRecords: "crm_source_records",
  permissionEvents: "crm_permission_events",
  suppressions: "crm_suppressions",
  importConflicts: "crm_import_conflicts",
  legacyDnc: "lead_run_org_dnc",
  invitationLedger: WARM_RECONNECT_INVITATION_LEDGER_COLLECTION,
  campaignLocks: "crm_warm_reconnect_campaign_locks",
} as const;


const EXECUTOR_COLLECTION = "executor";
const EXECUTOR_STATE_DOCUMENT = "state";
const RECEIPT_COLLECTION = "delivery_receipts";
const EVENT_COLLECTION = "events";
const QUERY_LIMIT = 50;
export const WARM_RECONNECT_CONTACT_SCAN_LIMIT = 501;
export const WARM_RECONNECT_SUPPRESSION_SCAN_LIMIT = 1_001;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const EXPECTED_GATE_IDS = new Set([
  "sender_legal_identity",
  "physical_postal_address",
  "preferences_unsubscribe_endpoint",
  "suppression_ledger",
  "spf_dkim_dmarc",
  "monitored_reply_to",
  "audience_provenance",
  "artwork_email_channel_approval",
  "google_profile_connection",
]);
const EXPECTED_EXCLUDED_SCOPE = [
  "audience_expansion",
  "provider_draft_create",
  "sms_send",
  "phone_call",
  "social_lookup",
  "social_direct_message",
  "ambiguous_outcome_retry",
] as const;

type ReceiptStatus =
  | "claimed"
  | "capabilities_prepared"
  | "provider_inflight"
  | "sent"
  | "delivery_unknown"
  | "stopped_before_provider";

interface ExecutorStateDocument {
  schemaVersion: "crm.warm-reconnect-executor-state.v1";
  pilotId: string;
  workspaceId: string;
  activeReceiptId: string | null;
  claimedCount: number;
  sentCount: number;
  lastProviderAttemptAtMs: number | null;
  nextEligibleAtMs: number | null;
  halted: boolean;
  complete: boolean;
}

interface DeliveryReceiptDocument {
  schemaVersion: "crm.warm-reconnect-delivery-receipt.v1";
  receiptId: string;
  pilotId: string;
  workspaceId: string;
  ownerUid: string;
  recipientId: string;
  personId: string;
  contactPointId: string;
  emailKey: string;
  approvalId: string;
  artifactFingerprint: string;
  audienceFingerprint: string;
  actionFingerprint: string;
  invitationReservationId: string;
  status: ReceiptStatus;
  claimedAtMs: number;
  preparedAtMs?: number;
  providerStartedAtMs?: number;
  sentAtMs?: number;
  stoppedAtMs?: number;
  preferenceCapabilityDigest?: string;
  unsubscribeCapabilityDigest?: string;
  capabilityExpiresAtMs?: number;
  providerMessageId?: string;
  providerThreadId?: string;
  terminalReason?: string;
  correlationId: string;
}

export type WarmReconnectPermissionReconciliation =
  | { ok: true; currentPermission: "unknown" | "opted_in" | "reconfirm_required" }
  | {
      ok: false;
      reason:
        | "permission_blocks_promotion"
        | "unsupported_permission_state"
        | "permission_state_drift";
    };

export type WarmReconnectSourceEvidenceReconciliation =
  | { ok: true }
  | { ok: false; reason: "source_evidence_drift" };

export type WarmReconnectExecutorProgressReconciliation =
  | { action: "stopped"; reason: string }
  | { action: "complete" }
  | {
      action: "stale";
      receiptIndex: number;
      terminalReason:
        | "stale_provider_outcome_requires_reconciliation"
        | "stale_pre_provider_claim_stopped";
      resultReason: "delivery_unknown" | "stale_pre_provider_claim";
    }
  | { action: "busy" }
  | { action: "waiting"; retryAfterMs: number }
  | { action: "claim"; recipientIndex: number };

interface CanonicalRecipient {
  email: string;
}

export interface WarmReconnectExecutorClaim {
  pilot: WarmReconnectPilot;
  recipient: WarmReconnectPilotRecipient;
  receiptId: string;
  email: string;
  claimedAtMs: number;
}

export type WarmReconnectClaimResult =
  | { kind: "claimed"; claim: WarmReconnectExecutorClaim }
  | { kind: "waiting"; retryAfterMs: number }
  | { kind: "busy" }
  | { kind: "complete" }
  | { kind: "stopped"; reason: string };

export type WarmReconnectExecutionResult =
  | { ok: true; outcome: "disabled"; providerCalled: false }
  | {
      ok: true;
      outcome: "waiting";
      providerCalled: false;
      retryAfterMs: number;
    }
  | { ok: true; outcome: "busy" | "complete"; providerCalled: false }
  | {
      ok: true;
      outcome: "stopped";
      providerCalled: false;
      reason: string;
    }
  | {
      ok: true;
      outcome: "sent";
      providerCalled: true;
      receiptId: string;
      complete: boolean;
    }
  | {
      ok: true;
      outcome: "delivery_unknown";
      providerCalled: true;
      receiptId: string;
      reconciliationRequired: boolean;
    };

export interface WarmReconnectExecutorDependencies {
  sendEnabled: () => boolean;
  claimNext: (input: {
    uid: string;
    pilotId: string;
    correlationId: string;
    now: Date;
    db: Firestore;
  }) => Promise<WarmReconnectClaimResult>;
  issueCapabilities: typeof issueWarmReconnectPreferenceCapabilities;
  markCapabilitiesPrepared: (input: {
    claim: WarmReconnectExecutorClaim;
    preferenceDigest: string;
    unsubscribeDigest: string;
    capabilityExpiresAtMs: number;
    correlationId: string;
    now: Date;
    db: Firestore;
  }) => Promise<void>;
  beginProviderAttempt: (input: {
    claim: WarmReconnectExecutorClaim;
    preferenceDigest: string;
    unsubscribeDigest: string;
    correlationId: string;
    now: Date;
    db: Firestore;
  }) => Promise<{ ready: true } | { ready: false; reason: string }>;
  resolveAccessToken: (input: {
    uid: string;
    pilot: WarmReconnectPilot;
  }) => Promise<string>;
  renderMessage: typeof renderWarmReconnectEmail;
  sendMessage: typeof sendWarmReconnectCampaignEmail;
  recordSent: (input: {
    claim: WarmReconnectExecutorClaim;
    providerMessageId: string;
    providerThreadId: string;
    correlationId: string;
    now: Date;
    db: Firestore;
  }) => Promise<{ complete: boolean }>;
  recordDeliveryUnknown: (input: {
    claim: WarmReconnectExecutorClaim;
    correlationId: string;
    now: Date;
    db: Firestore;
    reason: string;
  }) => Promise<{ alreadySent: boolean }>;
  recordStoppedBeforeProvider: (input: {
    claim: WarmReconnectExecutorClaim;
    correlationId: string;
    now: Date;
    db: Firestore;
    reason: string;
  }) => Promise<void>;
  loadCampaign: (input: {
    uid: string;
    log: Logger;
    db: Firestore;
  }) => Promise<ReturnType<typeof buildWarmReconnectCampaignDraft>>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "object") {
    try {
      return (
        (value as { toDate?: () => Date }).toDate?.().toISOString() || null
      );
    } catch {
      return null;
    }
  }
  return null;
}

function canonicalContactEmail(data: DocumentData): string | null {
  for (const key of [
    "normalizedValue",
    "contactEmail",
    "email",
    "value",
    "address",
  ]) {
    const value = asString(data[key]);
    if (value) return normalizeWarmReconnectEmail(value);
  }
  return null;
}

function canonicalContactPersonId(data: DocumentData): string {
  return (
    asString(data.personId) ||
    asString(data.crmPersonId) ||
    asString(data.personRef)
  );
}

function receiptIdFor(pilot: WarmReconnectPilot, recipientId: string): string {
  return `wre_${createHash("sha256")
    .update(
      `warm-reconnect-delivery:v1|${pilot.workspaceId}|${pilot.pilotId}|${recipientId}|${pilot.fingerprints.actionFingerprint}`
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function deterministicMessageId(claim: WarmReconnectExecutorClaim): string {
  const domain = claim.pilot.sender.fromEmail.split("@")[1]?.toLowerCase();
  if (!domain) throw new ApiError(409, "The approved sender email is invalid.");
  const local = createHash("sha256")
    .update(
      `warm-reconnect-message:v1|${claim.pilot.pilotId}|${claim.recipient.recipientId}|${claim.pilot.approval?.approvalId || ""}`
    )
    .digest("hex")
    .slice(0, 40);
  return `<warm-reconnect.${local}@${domain}>`;
}

function eventId(kind: string, receiptId: string, correlationId: string): string {
  return `executor_${createHash("sha256")
    .update(`${kind}|${receiptId}|${correlationId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function invitationLedgerDocument(
  binding: WarmReconnectInvitationReservationBinding,
  reservationGeneration: number,
  correlationId: string,
  now: Date
): WarmReconnectInvitationLedgerDocument {
  return {
    schemaVersion: "crm.warm-reconnect-invitation-ledger.v1",
    ...binding,
    status: "reserved",
    reservationGeneration,
    reservedAtMs: now.getTime(),
    correlationId,
  };
}

function invitationLedgerRef(
  db: Firestore,
  binding: WarmReconnectInvitationReservationBinding
): DocumentReference<DocumentData> {
  return db.collection(COLLECTIONS.invitationLedger).doc(binding.reservationId);
}

function initialPilotLockRef(
  db: Firestore,
  workspaceId: string
): DocumentReference<DocumentData> {
  return db
    .collection(COLLECTIONS.campaignLocks)
    .doc(warmReconnectInitialPilotLockId(workspaceId));
}

function assertOwnedActiveInitialPilotLock(
  value: DocumentData | undefined,
  pilot: WarmReconnectPilot
): void {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.workspaceId !== pilot.workspaceId ||
    value.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
    value.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION ||
    value.tranche !== "initial_5" ||
    value.state !== "active" ||
    value.pilotId !== pilot.pilotId
  ) {
    throw new ApiError(
      409,
      "The active initial-pilot lock could not be reconciled."
    );
  }
}

export function shouldReleaseWarmReconnectInitialPilotLock(input: {
  lastProviderAttemptAtMs: number | null;
  receipts: Array<{ status: ReceiptStatus } | null>;
}): boolean {
  return (
    input.lastProviderAttemptAtMs === null &&
    !input.receipts.some((receipt) =>
      ["provider_inflight", "sent", "delivery_unknown"].includes(
        receipt?.status || ""
      )
    )
  );
}

function assertInvitationLedgerBound(
  value: unknown,
  expected: WarmReconnectInvitationReservationBinding,
  allowedStatuses: readonly WarmReconnectInvitationLedgerStatus[]
): WarmReconnectInvitationLedgerDocument {
  const ledger = parseWarmReconnectInvitationLedgerDocument(value);
  if (
    !ledger ||
    !warmReconnectInvitationBindingMatches(ledger, expected) ||
    !allowedStatuses.includes(ledger.status)
  ) {
    throw new ApiError(409, "The one-time invitation reservation could not be reconciled.");
  }
  return ledger;
}

export function reconcileWarmReconnectPermission(input: {
  defaultPermissionState: string;
  eventStates: string[];
  latestPermissionState: string | null;
  approvedPermissionState: string;
}): WarmReconnectPermissionReconciliation {
  const eligible = new Set(["unknown", "opted_in", "reconfirm_required"]);
  const blocked = new Set(["opted_out", "transactional_only"]);
  const normalize = (value: string | null) => asString(value).toLowerCase();
  const defaultState = normalize(input.defaultPermissionState);
  const eventStates = input.eventStates.map(normalize).filter(Boolean);
  const allObserved = [defaultState, ...eventStates].filter(Boolean);
  if (
    !defaultState ||
    allObserved.some((state) => !eligible.has(state) && !blocked.has(state))
  ) {
    return { ok: false, reason: "unsupported_permission_state" };
  }
  if (allObserved.some((state) => blocked.has(state))) {
    return { ok: false, reason: "permission_blocks_promotion" };
  }
  const currentPermission = normalize(input.latestPermissionState) || defaultState;
  if (!eligible.has(currentPermission)) {
    return { ok: false, reason: "unsupported_permission_state" };
  }
  if (currentPermission !== normalize(input.approvedPermissionState)) {
    return { ok: false, reason: "permission_state_drift" };
  }
  return {
    ok: true,
    currentPermission: currentPermission as
      | "unknown"
      | "opted_in"
      | "reconfirm_required",
  };
}

export function reconcileWarmReconnectSourceEvidence(input: {
  approved: WarmReconnectSourceEvidence[];
  current: Array<{
    evidence: WarmReconnectSourceEvidence;
    referencesRecipient: boolean;
  }>;
}): WarmReconnectSourceEvidenceReconciliation {
  const approvedByRef = new Map(
    input.approved.map((evidence) => [evidence.evidenceRef, evidence])
  );
  if (
    input.current.length !== input.approved.length ||
    input.current.some(({ evidence, referencesRecipient }) => {
      const approved = approvedByRef.get(evidence.evidenceRef);
      return (
        !referencesRecipient ||
        !approved ||
        warmReconnectFingerprint(evidence) !== warmReconnectFingerprint(approved)
      );
    })
  ) {
    return { ok: false, reason: "source_evidence_drift" };
  }
  return { ok: true };
}

export function reconcileWarmReconnectExecutorProgress(input: {
  state: Pick<
    ExecutorStateDocument,
    "halted" | "complete" | "activeReceiptId" | "claimedCount" | "nextEligibleAtMs"
  >;
  receipts: Array<
    | (Pick<
        DeliveryReceiptDocument,
        "receiptId" | "status" | "claimedAtMs" | "preparedAtMs" | "providerStartedAtMs"
      > & { status: ReceiptStatus })
    | null
  >;
  nowMs: number;
  maxClaims: number;
  staleAfterMs: number;
}): WarmReconnectExecutorProgressReconciliation {
  if (input.state.halted) {
    return { action: "stopped", reason: "executor_halted" };
  }
  if (
    input.state.complete ||
    input.receipts.filter((receipt) => receipt?.status === "sent").length ===
      input.maxClaims
  ) {
    return { action: "complete" };
  }
  if (input.state.activeReceiptId) {
    const receiptIndex = input.receipts.findIndex(
      (receipt) => receipt?.receiptId === input.state.activeReceiptId
    );
    if (receiptIndex < 0) {
      return { action: "stopped", reason: "active_receipt_unreconciled" };
    }
    const receipt = input.receipts[receiptIndex]!;
    const startedAt =
      receipt.providerStartedAtMs || receipt.preparedAtMs || receipt.claimedAtMs;
    if (startedAt && input.nowMs - startedAt >= input.staleAfterMs) {
      const providerStarted = receipt.status === "provider_inflight";
      return {
        action: "stale",
        receiptIndex,
        terminalReason: providerStarted
          ? "stale_provider_outcome_requires_reconciliation"
          : "stale_pre_provider_claim_stopped",
        resultReason: providerStarted
          ? "delivery_unknown"
          : "stale_pre_provider_claim",
      };
    }
    return { action: "busy" };
  }
  const nextEligibleAtMs = Number(input.state.nextEligibleAtMs || 0);
  if (nextEligibleAtMs > input.nowMs) {
    return {
      action: "waiting",
      retryAfterMs: nextEligibleAtMs - input.nowMs,
    };
  }
  const recipientIndex = input.receipts.findIndex((receipt) => receipt === null);
  if (recipientIndex < 0) {
    return {
      action: "stopped",
      reason: "terminal_receipts_require_reconciliation",
    };
  }
  if (input.state.claimedCount >= input.maxClaims) {
    return { action: "stopped", reason: "pilot_claim_cap_reached" };
  }
  return { action: "claim", recipientIndex };
}

function validIdentifier(label: string, value: string): string {
  const normalized = asString(value);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new ApiError(400, `Invalid ${label}.`);
  }
  return normalized;
}

function pilotFromSnapshot(
  snapshot: DocumentSnapshot<DocumentData>,
  pilotId: string
): WarmReconnectPilot {
  const pilot = snapshot.data() as WarmReconnectPilot | undefined;
  if (
    !snapshot.exists ||
    !pilot ||
    pilot.schemaVersion !== WARM_RECONNECT_PILOT_SCHEMA_VERSION ||
    pilot.pilotId !== pilotId
  ) {
    throw new ApiError(404, "Warm reconnect pilot not found.");
  }
  return pilot;
}

function assertFrozenLaunchPilot(
  pilot: WarmReconnectPilot,
  uid: string,
  now: Date
): void {
  assertWarmReconnectPilotFingerprints(pilot);
  if (pilot.ownerUid !== uid) {
    throw new ApiError(404, "Warm reconnect pilot not found.");
  }
  if (
    pilot.workspaceId !== `workspace_default_${uid}` ||
    pilot.legacyDncOrgId !== pilot.workspaceId
  ) {
    throw new ApiError(409, "The server-owned suppression workspace binding drifted.");
  }
  if (
    pilot.status !== "launch_requested" ||
    !pilot.launchRequestedAt ||
    pilot.tranche !== "initial_5" ||
    pilot.recipientCap !== WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    pilot.recipients.length !== WARM_RECONNECT_INITIAL_PILOT_SIZE
  ) {
    throw new ApiError(409, "Only the exact launched five-person pilot can execute.");
  }
  if (
    new Set(pilot.recipients.map((recipient) => recipient.recipientId)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    new Set(pilot.recipients.map((recipient) => recipient.personId)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    new Set(pilot.recipients.map((recipient) => recipient.emailKey)).size !==
      WARM_RECONNECT_INITIAL_PILOT_SIZE ||
    pilot.recipients.some(
      (recipient) =>
        recipient.decision.status !== "eligible_one_time_reconnection" ||
        recipient.decision.relationshipAttested !== true ||
        !recipient.decision.decisionId ||
        recipient.decision.sourceEvidenceRefs.length === 0
    )
  ) {
    throw new ApiError(409, "The exact approved audience is no longer executable.");
  }
  if (
    !pilot.approval ||
    pilot.approval.decision !== "approved" ||
    pilot.approval.approvalScope !==
      "exact_five_one_time_reconnection_emails" ||
    JSON.stringify(pilot.approval.excludedScope) !==
      JSON.stringify(EXPECTED_EXCLUDED_SCOPE) ||
    !isWarmReconnectApprovalCurrent(pilot, now)
  ) {
    throw new ApiError(409, "The exact campaign approval is missing or expired.");
  }
  const gateIds = new Set(pilot.gates.map((gate) => gate.id));
  if (
    pilot.gates.length !== EXPECTED_GATE_IDS.size ||
    gateIds.size !== EXPECTED_GATE_IDS.size ||
    [...EXPECTED_GATE_IDS].some((id) => !gateIds.has(id as never)) ||
    pilot.gates.some((gate) => gate.status !== "verified")
  ) {
    throw new ApiError(409, "Every approved activation gate must remain verified.");
  }
  const profile = resolveGoogleBusinessProfileContext({
    businessId: pilot.sender.businessId,
    profileId: pilot.sender.profileId,
  });
  if (!profile || profile.profileId !== pilot.sender.profileId) {
    throw new ApiError(409, "The approved Google sender profile drifted.");
  }
  const from = normalizeWarmReconnectEmail(pilot.sender.fromEmail);
  const replyTo = normalizeWarmReconnectEmail(pilot.sender.replyTo);
  if (
    !from ||
    !replyTo ||
    from !== pilot.sender.fromEmail.toLowerCase() ||
    !IDENTIFIER_PATTERN.test(pilot.legacyDncOrgId)
  ) {
    throw new ApiError(409, "The approved sender or suppression binding is invalid.");
  }
  const origin = new URL(pilot.preferenceContract.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    pilot.preferenceContract.path !== "/preferences"
  ) {
    throw new ApiError(409, "The approved preference endpoint is invalid.");
  }
}

function emptyExecutorState(pilot: WarmReconnectPilot): ExecutorStateDocument {
  return {
    schemaVersion: "crm.warm-reconnect-executor-state.v1",
    pilotId: pilot.pilotId,
    workspaceId: pilot.workspaceId,
    activeReceiptId: null,
    claimedCount: 0,
    sentCount: 0,
    lastProviderAttemptAtMs: null,
    nextEligibleAtMs: null,
    halted: false,
    complete: false,
  };
}

function parseExecutorState(
  data: DocumentData | undefined,
  pilot: WarmReconnectPilot
): ExecutorStateDocument {
  if (!data) return emptyExecutorState(pilot);
  if (
    data.schemaVersion !== "crm.warm-reconnect-executor-state.v1" ||
    data.pilotId !== pilot.pilotId ||
    data.workspaceId !== pilot.workspaceId
  ) {
    throw new ApiError(409, "Warm reconnect executor state could not be reconciled.");
  }
  return {
    ...emptyExecutorState(pilot),
    ...(data as ExecutorStateDocument),
  };
}

function parseReceipt(
  snapshot: DocumentSnapshot<DocumentData>
): DeliveryReceiptDocument | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data() as DeliveryReceiptDocument | undefined;
  if (
    !data ||
    data.schemaVersion !== "crm.warm-reconnect-delivery-receipt.v1" ||
    data.receiptId !== snapshot.id
  ) {
    throw new ApiError(409, "Warm reconnect delivery receipt could not be reconciled.");
  }
  return data;
}

function evidenceFromSnapshot(
  snapshot: DocumentSnapshot<DocumentData>
): WarmReconnectSourceEvidence {
  const data = snapshot.data() || {};
  return {
    evidenceRef: `${COLLECTIONS.sourceRecords}/${snapshot.id}`,
    sourceSystem: asString(data.sourceSystem) || "other",
    permissionBasis: asString(data.permissionBasis) || "none",
    observedAt:
      timestampToIso(data.observedAt) ||
      timestampToIso(data.updatedAt) ||
      timestampToIso(data.createdAt),
  };
}

function sourceReferencesRecipient(
  data: DocumentData,
  recipient: WarmReconnectPilotRecipient
): boolean {
  const contactIds = new Set([
    asString(data.contactPointId),
    ...asStringArray(data.contactPointIds),
  ].filter(Boolean));
  const personIds = new Set([
    asString(data.personId),
    asString(data.crmPersonId),
    ...asStringArray(data.personIds),
  ].filter(Boolean));
  if (
    personIds.size > 1 ||
    [...personIds].some((personId) => personId !== recipient.personId)
  ) {
    return false;
  }
  return (
    contactIds.has(recipient.contactPointId) || personIds.has(recipient.personId)
  );
}

export function warmReconnectRecipientTargetQuerySpecs(
  recipient: Pick<
    WarmReconnectPilotRecipient,
    "contactPointId" | "personId"
  >
): Array<{
  field:
    | "contactPointId"
    | "contactPointIds"
    | "personId"
    | "crmPersonId"
    | "personIds";
  operator: "==" | "array-contains";
  value: string;
}> {
  return [
    {
      field: "contactPointId",
      operator: "==",
      value: recipient.contactPointId,
    },
    {
      field: "contactPointIds",
      operator: "array-contains",
      value: recipient.contactPointId,
    },
    { field: "personId", operator: "==", value: recipient.personId },
    { field: "crmPersonId", operator: "==", value: recipient.personId },
    {
      field: "personIds",
      operator: "array-contains",
      value: recipient.personId,
    },
  ];
}

export function reconcileWarmReconnectWorkspaceEmailUniqueness(input: {
  workspaceId: string;
  targetContactPointId: string;
  expectedEmailKey: string;
  scanSize: number;
  documents: Array<{ id: string; data: DocumentData }>;
}):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "canonical_email_scan_truncated"
        | "canonical_email_not_unique";
    } {
  if (input.scanSize >= WARM_RECONNECT_CONTACT_SCAN_LIMIT) {
    return { ok: false, reason: "canonical_email_scan_truncated" };
  }
  const matches = input.documents.filter((document) => {
    const email = canonicalContactEmail(document.data);
    return (
      asString(document.data.workspaceId) === input.workspaceId &&
      asString(document.data.type).toLowerCase() === "email" &&
      Boolean(
        email &&
          warmReconnectEmailKey(input.workspaceId, email) ===
            input.expectedEmailKey
      )
    );
  });
  return matches.length === 1 && matches[0].id === input.targetContactPointId
    ? { ok: true }
    : { ok: false, reason: "canonical_email_not_unique" };
}

function recipientTargetQueries(
  collection: CollectionReference<DocumentData>,
  recipient: Pick<WarmReconnectPilotRecipient, "contactPointId" | "personId">
): Query<DocumentData>[] {
  return warmReconnectRecipientTargetQuerySpecs(recipient).map((spec) =>
    collection.where(spec.field, spec.operator, spec.value).limit(QUERY_LIMIT)
  );
}

async function getQueryDocuments(
  transaction: Transaction,
  queries: Query<DocumentData>[]
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const byPath = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  for (const query of queries) {
    const snapshot = await transaction.get(query);
    if (snapshot.size >= QUERY_LIMIT) {
      throw new ApiError(409, "Recipient safety evidence exceeded its bounded scan.");
    }
    for (const document of snapshot.docs) byPath.set(document.ref.path, document);
  }
  return [...byPath.values()];
}

function documentMatchesWorkspace(
  document: QueryDocumentSnapshot<DocumentData>,
  workspaceId: string
): boolean {
  return asString(document.data().workspaceId) === workspaceId;
}

function isActiveSuppression(data: DocumentData): boolean {
  if (data.active === false) return false;
  if (["inactive", "resolved", "removed"].includes(asString(data.status))) {
    return false;
  }
  if (["unsuppressed", "inactive"].includes(asString(data.state))) return false;
  return true;
}

export function reconcileWarmReconnectWorkspaceSuppressionScan(input: {
  workspaceId: string;
  normalizedEmail: string;
  scanSize: number;
  documents: DocumentData[];
}):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "canonical_suppression_scan_truncated"
        | "canonical_suppression_present";
    } {
  if (input.scanSize >= WARM_RECONNECT_SUPPRESSION_SCAN_LIMIT) {
    return { ok: false, reason: "canonical_suppression_scan_truncated" };
  }
  const blocked = input.documents.some((data) => {
    if (asString(data.workspaceId) !== input.workspaceId) return false;
    const suppressionEmail = canonicalContactEmail(data);
    return (
      Boolean(suppressionEmail) &&
      suppressionEmail === input.normalizedEmail &&
      isActiveSuppression(data)
    );
  });
  return blocked
    ? { ok: false, reason: "canonical_suppression_present" }
    : { ok: true };
}

function permissionEventState(data: DocumentData): string {
  return (
    asString(data.permissionState) ||
    asString(data.toState) ||
    asString(data.state)
  ).toLowerCase();
}

function permissionEventTime(data: DocumentData): number {
  const iso =
    timestampToIso(data.occurredAt) ||
    timestampToIso(data.updatedAt) ||
    timestampToIso(data.createdAt);
  return iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY;
}

async function inspectCanonicalRecipient(
  transaction: Transaction,
  db: Firestore,
  pilot: WarmReconnectPilot,
  recipient: WarmReconnectPilotRecipient
): Promise<{ canonical: CanonicalRecipient | null; blockedReason: string | null }> {
  const contactRef = db
    .collection(COLLECTIONS.contactPoints)
    .doc(recipient.contactPointId);
  const personRef = db.collection(COLLECTIONS.people).doc(recipient.personId);
  const [contactSnapshot, personSnapshot] = await Promise.all([
    transaction.get(contactRef),
    transaction.get(personRef),
  ]);
  if (!contactSnapshot.exists || !personSnapshot.exists) {
    return { canonical: null, blockedReason: "canonical_recipient_missing" };
  }
  const contact = contactSnapshot.data() || {};
  const person = personSnapshot.data() || {};
  const email = canonicalContactEmail(contact);
  if (
    asString(contact.workspaceId) !== pilot.workspaceId ||
    asString(contact.type).toLowerCase() !== "email" ||
    canonicalContactPersonId(contact) !== recipient.personId ||
    (asString(person.workspaceId) && asString(person.workspaceId) !== pilot.workspaceId) ||
    !email ||
    warmReconnectEmailKey(pilot.workspaceId, email) !== recipient.emailKey
  ) {
    return { canonical: null, blockedReason: "canonical_recipient_drift" };
  }
  const contactScan = await transaction.get(
    db
      .collection(COLLECTIONS.contactPoints)
      .where("workspaceId", "==", pilot.workspaceId)
      .where("type", "==", "email")
      .limit(WARM_RECONNECT_CONTACT_SCAN_LIMIT)
  );
  const uniqueness = reconcileWarmReconnectWorkspaceEmailUniqueness({
    workspaceId: pilot.workspaceId,
    targetContactPointId: recipient.contactPointId,
    expectedEmailKey: recipient.emailKey,
    scanSize: contactScan.size,
    documents: contactScan.docs.map((document) => ({
      id: document.id,
      data: document.data(),
    })),
  });
  if (!uniqueness.ok) {
    return { canonical: null, blockedReason: uniqueness.reason };
  }

  const domain = email.split("@")[1] || "";
  const legacyRefs = [
    db
      .collection(COLLECTIONS.legacyDnc)
      .doc(pilot.legacyDncOrgId)
      .collection("entries")
      .doc(computeDncEntryId("email", email)),
    ...expandDomainCandidates(domain).map((candidate) =>
      db
        .collection(COLLECTIONS.legacyDnc)
        .doc(pilot.legacyDncOrgId)
        .collection("entries")
        .doc(computeDncEntryId("domain", candidate))
    ),
  ];
  const legacySnapshots = await Promise.all(
    legacyRefs.map((reference) => transaction.get(reference))
  );
  if (legacySnapshots.some((snapshot) => snapshot.exists)) {
    return { canonical: null, blockedReason: "legacy_suppression_present" };
  }

  const suppressionCollection = db.collection(COLLECTIONS.suppressions);
  const suppressionQueries = [
    ...recipientTargetQueries(suppressionCollection, recipient),
    suppressionCollection.where("emailKey", "==", recipient.emailKey),
    suppressionCollection.where("contactPointKey", "==", recipient.emailKey),
    suppressionCollection.where("normalizedValue", "==", email),
    suppressionCollection.where("email", "==", email),
    suppressionCollection.where("value", "==", email),
    suppressionCollection.where("address", "==", email),
  ].map((query) => query.limit(QUERY_LIMIT));
  const suppressions = (
    await getQueryDocuments(transaction, suppressionQueries)
  ).filter((document) => documentMatchesWorkspace(document, pilot.workspaceId));
  const suppressionScan = await transaction.get(
    suppressionCollection
      .where("workspaceId", "==", pilot.workspaceId)
      .limit(WARM_RECONNECT_SUPPRESSION_SCAN_LIMIT)
  );
  const suppressionReconciliation =
    reconcileWarmReconnectWorkspaceSuppressionScan({
      workspaceId: pilot.workspaceId,
      normalizedEmail: email,
      scanSize: suppressionScan.size,
      documents: suppressionScan.docs.map((document) => document.data()),
    });
  if (
    contact.suppressed === true ||
    suppressions.some((document) => isActiveSuppression(document.data())) ||
    !suppressionReconciliation.ok
  ) {
    return {
      canonical: null,
      blockedReason: suppressionReconciliation.ok
        ? "canonical_suppression_present"
        : suppressionReconciliation.reason,
    };
  }

  const permissionCollection = db.collection(COLLECTIONS.permissionEvents);
  const permissionQueries = recipientTargetQueries(
    permissionCollection,
    recipient
  );
  const permissionEvents = (
    await getQueryDocuments(transaction, permissionQueries)
  ).filter((document) => documentMatchesWorkspace(document, pilot.workspaceId));
  const latestPermission = permissionEvents
    .map((document) => ({
      id: document.id,
      state: permissionEventState(document.data()),
      at: permissionEventTime(document.data()),
    }))
    .filter((event) => Boolean(event.state))
    .sort((left, right) => right.at - left.at || right.id.localeCompare(left.id))[0];
  const permission = reconcileWarmReconnectPermission({
    defaultPermissionState: asString(contact.defaultPermissionState),
    eventStates: permissionEvents.map((document) =>
      permissionEventState(document.data())
    ),
    latestPermissionState: latestPermission?.state || null,
    approvedPermissionState: recipient.decision.permissionState,
  });
  if (!permission.ok) {
    return { canonical: null, blockedReason: permission.reason };
  }
  const currentPermission = permission.currentPermission;

  const conflictCollection = db.collection(COLLECTIONS.importConflicts);
  const conflictQueries = recipientTargetQueries(conflictCollection, recipient);
  const conflicts = (
    await getQueryDocuments(transaction, conflictQueries)
  ).filter((document) => documentMatchesWorkspace(document, pilot.workspaceId));
  if (conflicts.some((document) => asString(document.data().status) === "open")) {
    return { canonical: null, blockedReason: "open_import_conflict" };
  }

  const sourceCollection = db.collection(COLLECTIONS.sourceRecords);
  const sourceQueries = recipientTargetQueries(sourceCollection, recipient);
  const sourceSnapshots = (
    await getQueryDocuments(transaction, sourceQueries)
  ).filter((document) => documentMatchesWorkspace(document, pilot.workspaceId));
  const sourceEvidence = reconcileWarmReconnectSourceEvidence({
    approved: recipient.sourceEvidence,
    current: sourceSnapshots.map((snapshot) => ({
      evidence: evidenceFromSnapshot(snapshot),
      referencesRecipient: sourceReferencesRecipient(
        snapshot.data() || {},
        recipient
      ),
    })),
  });
  if (!sourceEvidence.ok) {
    return { canonical: null, blockedReason: sourceEvidence.reason };
  }
  const sortedEvidence = [...recipient.sourceEvidence].sort((left, right) =>
    left.evidenceRef.localeCompare(right.evidenceRef)
  );
  const currentCandidateFingerprint = warmReconnectFingerprint({
    contract: "warm-reconnect-candidate.v1",
    personId: recipient.personId,
    contactPointId: recipient.contactPointId,
    emailKey: recipient.emailKey,
    permissionState: currentPermission,
    sourceEvidence: sortedEvidence,
  });
  if (currentCandidateFingerprint !== recipient.candidateFingerprint) {
    return { canonical: null, blockedReason: "candidate_fingerprint_drift" };
  }

  return {
    canonical: { email },
    blockedReason: null,
  };
}

function stopPilot(
  transaction: Transaction,
  input: {
    pilotRef: DocumentReference<DocumentData>;
    stateRef: DocumentReference<DocumentData>;
    initialLockRef: DocumentReference<DocumentData>;
    initialLockData: DocumentData | undefined;
    releaseInitialLock: boolean;
    pilot: WarmReconnectPilot;
    state: ExecutorStateDocument;
    receiptRef?: DocumentReference<DocumentData>;
    receipt?: DeliveryReceiptDocument | null;
    reason: string;
    correlationId: string;
    now: Date;
  }
): void {
  assertOwnedActiveInitialPilotLock(input.initialLockData, input.pilot);
  const nowIso = input.now.toISOString();
  if (input.releaseInitialLock) {
    transaction.set(
      input.initialLockRef,
      {
        state: "released_before_provider",
        pilotId: input.pilot.pilotId,
        releaseReason: input.reason,
        releasedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  transaction.set(
    input.pilotRef,
    {
      status: "stopped",
      approval: null,
      stoppedAt: nowIso,
      stopReason: input.reason,
      updatedAt: nowIso,
    },
    { merge: true }
  );
  transaction.set(
    input.stateRef,
    {
      ...input.state,
      activeReceiptId: null,
      halted: true,
      complete: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (input.receiptRef && input.receipt) {
    const terminalReceiptStatus: ReceiptStatus =
      input.receipt.status === "provider_inflight"
        ? "delivery_unknown"
        : input.receipt.status === "sent"
          ? "sent"
          : "stopped_before_provider";
    transaction.set(
      input.receiptRef,
      {
        status: terminalReceiptStatus,
        stoppedAtMs: input.now.getTime(),
        terminalReason: input.reason,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  const receiptId = input.receipt?.receiptId || input.pilot.pilotId;
  transaction.set(
    input.pilotRef
      .collection(EVENT_COLLECTION)
      .doc(eventId("executor_stopped", receiptId, input.correlationId)),
    {
      kind: "executor_stopped",
      pilotId: input.pilot.pilotId,
      workspaceId: input.pilot.workspaceId,
      receiptId: input.receipt?.receiptId || null,
      reason: input.reason,
      correlationId: input.correlationId,
      actionFingerprint: input.pilot.fingerprints.actionFingerprint,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: false }
  );
}

export function isWarmReconnectProviderSendEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return asString(env[WARM_RECONNECT_PROVIDER_SEND_FLAG]).toLowerCase() === "true";
}

export function isWarmReconnectGmailSendScopeExact(
  grantedScope: string | null | undefined
): boolean {
  return isGoogleTokenScopeBoundedForPreset("gmail_send", grantedScope);
}

export async function claimNextWarmReconnectRecipient(input: {
  uid: string;
  pilotId: string;
  correlationId: string;
  now: Date;
  db: Firestore;
}): Promise<WarmReconnectClaimResult> {
  const uid = validIdentifier("owner uid", input.uid);
  const pilotId = validIdentifier("pilot id", input.pilotId);
  const correlationId = validIdentifier("correlation id", input.correlationId);
  const pilotRef = input.db.collection(COLLECTIONS.pilots).doc(pilotId);
  const stateRef = pilotRef
    .collection(EXECUTOR_COLLECTION)
    .doc(EXECUTOR_STATE_DOCUMENT);

  return input.db.runTransaction(async (transaction) => {
    const [pilotSnapshot, stateSnapshot] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, pilotId);
    assertFrozenLaunchPilot(pilot, uid, input.now);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const initialLockRef = initialPilotLockRef(input.db, pilot.workspaceId);
    const initialLockSnapshot = await transaction.get(initialLockRef);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const receiptRefs = pilot.recipients.map((recipient) =>
      pilotRef.collection(RECEIPT_COLLECTION).doc(receiptIdFor(pilot, recipient.recipientId))
    );
    const receiptSnapshots = await Promise.all(
      receiptRefs.map((reference) => transaction.get(reference))
    );
    const receipts = receiptSnapshots.map(parseReceipt);
    const canReleaseInitialLock = shouldReleaseWarmReconnectInitialPilotLock({
      lastProviderAttemptAtMs: state.lastProviderAttemptAtMs,
      receipts,
    });
    const progress = reconcileWarmReconnectExecutorProgress({
      state,
      receipts,
      nowMs: input.now.getTime(),
      maxClaims: WARM_RECONNECT_INITIAL_PILOT_SIZE,
      staleAfterMs: WARM_RECONNECT_INFLIGHT_RECONCILIATION_MS,
    });
    if (progress.action === "complete") return { kind: "complete" };
    if (progress.action === "busy") return { kind: "busy" };
    if (progress.action === "waiting") {
      return { kind: "waiting", retryAfterMs: progress.retryAfterMs };
    }
    if (progress.action === "stopped") {
      if (progress.reason === "executor_halted") {
        return { kind: "stopped", reason: progress.reason };
      }
      stopPilot(transaction, {
        pilotRef,
        stateRef,
        initialLockRef,
        initialLockData: initialLockSnapshot.data(),
        releaseInitialLock: canReleaseInitialLock,
        pilot,
        state,
        reason: progress.reason,
        correlationId,
        now: input.now,
      });
      return { kind: "stopped", reason: progress.reason };
    }
    if (progress.action === "stale") {
      const activeReceipt = receipts[progress.receiptIndex]!;
      const activeRecipient = pilot.recipients.find(
        (recipient) => recipient.recipientId === activeReceipt.recipientId
      );
      if (!activeRecipient) {
        stopPilot(transaction, {
          pilotRef,
          stateRef,
          initialLockRef,
          initialLockData: initialLockSnapshot.data(),
          releaseInitialLock: false,
          pilot,
          state,
          receiptRef: receiptRefs[progress.receiptIndex],
          receipt: activeReceipt,
          reason: "invitation_ledger_unreconciled",
          correlationId,
          now: input.now,
        });
        return { kind: "stopped", reason: "invitation_ledger_unreconciled" };
      }
      const binding = warmReconnectInvitationReservationBindingForPilot(
        pilot,
        activeRecipient,
        activeReceipt.receiptId
      );
      const ledgerRef = invitationLedgerRef(input.db, binding);
      const ledgerSnapshot = await transaction.get(ledgerRef);
      const ledger = parseWarmReconnectInvitationLedgerDocument(
        ledgerSnapshot.data()
      );
      if (
        !ledger ||
        !warmReconnectInvitationBindingMatches(ledger, binding) ||
        activeReceipt.invitationReservationId !== binding.reservationId ||
        (activeReceipt.status === "provider_inflight"
          ? !["provider_inflight", "sent", "delivery_unknown"].includes(
              ledger.status
            )
          : !["reserved", "released_before_provider"].includes(ledger.status))
      ) {
        stopPilot(transaction, {
          pilotRef,
          stateRef,
          initialLockRef,
          initialLockData: initialLockSnapshot.data(),
          releaseInitialLock: false,
          pilot,
          state,
          receiptRef: receiptRefs[progress.receiptIndex],
          receipt: activeReceipt,
          reason: "invitation_ledger_unreconciled",
          correlationId,
          now: input.now,
        });
        return { kind: "stopped", reason: "invitation_ledger_unreconciled" };
      }
      if (
        activeReceipt.status === "provider_inflight" &&
        ledger.status === "provider_inflight"
      ) {
        transaction.set(
          ledgerRef,
          {
            status: "delivery_unknown",
            terminalAtMs: input.now.getTime(),
            correlationId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else if (
        activeReceipt.status !== "provider_inflight" &&
        ledger.status === "reserved"
      ) {
        transaction.set(
          ledgerRef,
          {
            status: "released_before_provider",
            releasedAtMs: input.now.getTime(),
            correlationId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      stopPilot(transaction, {
        pilotRef,
        stateRef,
          initialLockRef,
          initialLockData: initialLockSnapshot.data(),
          releaseInitialLock:
            canReleaseInitialLock &&
            activeReceipt.status !== "provider_inflight",
          pilot,
          state,
          receiptRef: receiptRefs[progress.receiptIndex],
          receipt: activeReceipt,
          reason: progress.terminalReason,
          correlationId,
          now: input.now,
      });
      return { kind: "stopped", reason: progress.resultReason };
    }
    const recipientIndex = progress.recipientIndex;
    const recipient = pilot.recipients[recipientIndex];
    const safety = await inspectCanonicalRecipient(
      transaction,
      input.db,
      pilot,
      recipient
    );
    if (!safety.canonical || safety.blockedReason) {
      stopPilot(transaction, {
        pilotRef,
        stateRef,
        initialLockRef,
        initialLockData: initialLockSnapshot.data(),
        releaseInitialLock: canReleaseInitialLock,
        pilot,
        state,
        reason: safety.blockedReason || "canonical_recipient_unavailable",
        correlationId,
        now: input.now,
      });
      return {
        kind: "stopped",
        reason: safety.blockedReason || "canonical_recipient_unavailable",
      };
    }

    const approval = pilot.approval!;
    const receiptRef = receiptRefs[recipientIndex];
    const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
      pilot,
      recipient,
      receiptRef.id
    );
    const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
    const ledgerSnapshot = await transaction.get(ledgerRef);
    const reservation = reconcileWarmReconnectInvitationReservation(
      ledgerSnapshot.data(),
      invitationBinding
    );
    if (reservation.action === "conflict") {
      stopPilot(transaction, {
        pilotRef,
        stateRef,
        initialLockRef,
        initialLockData: initialLockSnapshot.data(),
        releaseInitialLock: false,
        pilot,
        state,
        reason: reservation.reason,
        correlationId,
        now: input.now,
      });
      return { kind: "stopped", reason: reservation.reason };
    }
    const receipt: DeliveryReceiptDocument = {
      schemaVersion: "crm.warm-reconnect-delivery-receipt.v1",
      receiptId: receiptRef.id,
      pilotId: pilot.pilotId,
      workspaceId: pilot.workspaceId,
      ownerUid: uid,
      recipientId: recipient.recipientId,
      personId: recipient.personId,
      contactPointId: recipient.contactPointId,
      emailKey: recipient.emailKey,
      approvalId: approval.approvalId,
      artifactFingerprint: pilot.fingerprints.artifactFingerprint,
      audienceFingerprint: pilot.fingerprints.audienceFingerprint,
      actionFingerprint: pilot.fingerprints.actionFingerprint,
      invitationReservationId: invitationBinding.reservationId,
      status: "claimed",
      claimedAtMs: input.now.getTime(),
      correlationId,
    };
    if (reservation.action === "reserve") {
      const ledgerWrite: DocumentData = {
        ...invitationLedgerDocument(
          invitationBinding,
          reservation.reservationGeneration,
          correlationId,
          input.now
        ),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (reservation.reservationGeneration === 1) {
        ledgerWrite.createdAt = FieldValue.serverTimestamp();
      }
      transaction.set(
        ledgerRef,
        ledgerWrite,
        { merge: reservation.reservationGeneration !== 1 }
      );
    }
    transaction.create(receiptRef, {
      ...receipt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      stateRef,
      {
        ...state,
        activeReceiptId: receipt.receiptId,
        claimedCount: state.claimedCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      pilotRef
        .collection(EVENT_COLLECTION)
        .doc(eventId("recipient_claimed", receipt.receiptId, correlationId)),
      {
        kind: "recipient_claimed",
        pilotId: pilot.pilotId,
        workspaceId: pilot.workspaceId,
        receiptId: receipt.receiptId,
        recipientId: recipient.recipientId,
        approvalId: approval.approvalId,
        actionFingerprint: pilot.fingerprints.actionFingerprint,
        correlationId,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    return {
      kind: "claimed",
      claim: {
        pilot,
        recipient,
        receiptId: receipt.receiptId,
        email: safety.canonical.email,
        claimedAtMs: input.now.getTime(),
      },
    };
  });
}

function assertReceiptBoundToClaim(
  receipt: DeliveryReceiptDocument | null,
  claim: WarmReconnectExecutorClaim,
  currentPilot: WarmReconnectPilot
): DeliveryReceiptDocument {
  if (
    !receipt ||
    currentPilot.pilotId !== claim.pilot.pilotId ||
    currentPilot.workspaceId !== claim.pilot.workspaceId ||
    currentPilot.ownerUid !== claim.pilot.ownerUid ||
    currentPilot.fingerprints.artifactFingerprint !==
      claim.pilot.fingerprints.artifactFingerprint ||
    currentPilot.fingerprints.audienceFingerprint !==
      claim.pilot.fingerprints.audienceFingerprint ||
    currentPilot.fingerprints.actionFingerprint !==
      claim.pilot.fingerprints.actionFingerprint ||
    receipt.pilotId !== currentPilot.pilotId ||
    receipt.workspaceId !== currentPilot.workspaceId ||
    receipt.ownerUid !== currentPilot.ownerUid ||
    receipt.recipientId !== claim.recipient.recipientId ||
    receipt.emailKey !== claim.recipient.emailKey ||
    receipt.artifactFingerprint !== currentPilot.fingerprints.artifactFingerprint ||
    receipt.audienceFingerprint !== currentPilot.fingerprints.audienceFingerprint ||
    receipt.actionFingerprint !== currentPilot.fingerprints.actionFingerprint ||
    receipt.approvalId !== currentPilot.approval?.approvalId ||
    receipt.approvalId !== claim.pilot.approval?.approvalId ||
    receipt.invitationReservationId !==
      warmReconnectInvitationReservationBindingForPilot(
        currentPilot,
        claim.recipient,
        receipt.receiptId
      ).reservationId
  ) {
    throw new ApiError(409, "Delivery claim no longer matches the approved action.");
  }
  return receipt;
}

export async function markWarmReconnectCapabilitiesPrepared(input: {
  claim: WarmReconnectExecutorClaim;
  preferenceDigest: string;
  unsubscribeDigest: string;
  capabilityExpiresAtMs: number;
  correlationId: string;
  now: Date;
  db: Firestore;
}): Promise<void> {
  const pilotRef = input.db
    .collection(COLLECTIONS.pilots)
    .doc(input.claim.pilot.pilotId);
  const stateRef = pilotRef.collection(EXECUTOR_COLLECTION).doc(EXECUTOR_STATE_DOCUMENT);
  const receiptRef = pilotRef.collection(RECEIPT_COLLECTION).doc(input.claim.receiptId);
  const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
    input.claim.pilot,
    input.claim.recipient,
    input.claim.receiptId
  );
  const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
  const initialLockRef = initialPilotLockRef(
    input.db,
    input.claim.pilot.workspaceId
  );
  await input.db.runTransaction(async (transaction) => {
    const [
      pilotSnapshot,
      stateSnapshot,
      receiptSnapshot,
      ledgerSnapshot,
      initialLockSnapshot,
    ] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
      transaction.get(receiptRef),
      transaction.get(ledgerRef),
      transaction.get(initialLockRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, input.claim.pilot.pilotId);
    assertFrozenLaunchPilot(pilot, input.claim.pilot.ownerUid, input.now);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const receipt = assertReceiptBoundToClaim(
      parseReceipt(receiptSnapshot),
      input.claim,
      pilot
    );
    assertInvitationLedgerBound(ledgerSnapshot.data(), invitationBinding, [
      "reserved",
    ]);
    if (
      state.activeReceiptId !== receipt.receiptId ||
      receipt.status !== "claimed" ||
      !/^[a-f0-9]{64}$/.test(input.preferenceDigest) ||
      !/^[a-f0-9]{64}$/.test(input.unsubscribeDigest) ||
      input.preferenceDigest === input.unsubscribeDigest ||
      input.capabilityExpiresAtMs - input.now.getTime() <
        WARM_RECONNECT_CAPABILITY_TTL_MS - 1_000
    ) {
      throw new ApiError(409, "Preference capabilities could not be bound to this claim.");
    }
    transaction.set(
      receiptRef,
      {
        status: "capabilities_prepared",
        preferenceCapabilityDigest: input.preferenceDigest,
        unsubscribeCapabilityDigest: input.unsubscribeDigest,
        capabilityExpiresAtMs: input.capabilityExpiresAtMs,
        preparedAtMs: input.now.getTime(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      pilotRef
        .collection(EVENT_COLLECTION)
        .doc(eventId("capabilities_prepared", receipt.receiptId, input.correlationId)),
      {
        kind: "capabilities_prepared",
        pilotId: pilot.pilotId,
        workspaceId: pilot.workspaceId,
        receiptId: receipt.receiptId,
        correlationId: input.correlationId,
        actionFingerprint: pilot.fingerprints.actionFingerprint,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
  });
}

export async function beginWarmReconnectProviderAttempt(input: {
  claim: WarmReconnectExecutorClaim;
  preferenceDigest: string;
  unsubscribeDigest: string;
  correlationId: string;
  now: Date;
  db: Firestore;
}): Promise<{ ready: true } | { ready: false; reason: string }> {
  const pilotRef = input.db
    .collection(COLLECTIONS.pilots)
    .doc(input.claim.pilot.pilotId);
  const stateRef = pilotRef.collection(EXECUTOR_COLLECTION).doc(EXECUTOR_STATE_DOCUMENT);
  const receiptRef = pilotRef.collection(RECEIPT_COLLECTION).doc(input.claim.receiptId);
  const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
    input.claim.pilot,
    input.claim.recipient,
    input.claim.receiptId
  );
  const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
  const initialLockRef = initialPilotLockRef(
    input.db,
    input.claim.pilot.workspaceId
  );
  return input.db.runTransaction(async (transaction) => {
    const [
      pilotSnapshot,
      stateSnapshot,
      receiptSnapshot,
      ledgerSnapshot,
      initialLockSnapshot,
    ] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
      transaction.get(receiptRef),
      transaction.get(ledgerRef),
      transaction.get(initialLockRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, input.claim.pilot.pilotId);
    assertFrozenLaunchPilot(pilot, input.claim.pilot.ownerUid, input.now);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const receipt = assertReceiptBoundToClaim(
      parseReceipt(receiptSnapshot),
      input.claim,
      pilot
    );
    const ledgerTransition = reconcileWarmReconnectInvitationTransition({
      existing: ledgerSnapshot.data(),
      expected: invitationBinding,
      target: "provider_inflight",
    });
    const safety = await inspectCanonicalRecipient(
      transaction,
      input.db,
      pilot,
      input.claim.recipient
    );
    const cadenceReady =
      !state.lastProviderAttemptAtMs ||
      input.now.getTime() - state.lastProviderAttemptAtMs >=
        WARM_RECONNECT_MIN_CADENCE_MS;
    const reservationReady =
      ledgerTransition.ok && ledgerTransition.action === "transition";
    if (
      !safety.canonical ||
      safety.blockedReason ||
      !reservationReady ||
      !cadenceReady ||
      state.halted ||
      state.complete ||
      state.activeReceiptId !== receipt.receiptId ||
      receipt.status !== "capabilities_prepared" ||
      receipt.preferenceCapabilityDigest !== input.preferenceDigest ||
      receipt.unsubscribeCapabilityDigest !== input.unsubscribeDigest
    ) {
      const reason =
        safety.blockedReason ||
        (!reservationReady
          ? "cross_pilot_one_time_invitation_conflict"
          : !cadenceReady
            ? "provider_cadence_not_ready"
            : "provider_boundary_drift");
      if (reservationReady) {
        transaction.set(
          ledgerRef,
          {
            status: "released_before_provider",
            releasedAtMs: input.now.getTime(),
            correlationId: input.correlationId,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      stopPilot(transaction, {
        pilotRef,
        stateRef,
        initialLockRef,
        initialLockData: initialLockSnapshot.data(),
        releaseInitialLock:
          reservationReady &&
          state.lastProviderAttemptAtMs === null &&
          state.sentCount === 0,
        pilot,
        state,
        receiptRef,
        receipt,
        reason,
        correlationId: input.correlationId,
        now: input.now,
      });
      return { ready: false as const, reason };
    }
    const providerStartedAtMs = input.now.getTime();
    transaction.set(
      receiptRef,
      {
        status: "provider_inflight",
        providerStartedAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      ledgerRef,
      {
        status: "provider_inflight",
        providerStartedAtMs,
        correlationId: input.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      stateRef,
      {
        lastProviderAttemptAtMs: providerStartedAtMs,
        nextEligibleAtMs:
          providerStartedAtMs + WARM_RECONNECT_MIN_CADENCE_MS,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      pilotRef
        .collection(EVENT_COLLECTION)
        .doc(eventId("provider_started", receipt.receiptId, input.correlationId)),
      {
        kind: "provider_started",
        pilotId: pilot.pilotId,
        workspaceId: pilot.workspaceId,
        receiptId: receipt.receiptId,
        correlationId: input.correlationId,
        approvalId: receipt.approvalId,
        actionFingerprint: receipt.actionFingerprint,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    return { ready: true as const };
  });
}

export async function resolveWarmReconnectGmailAccessToken(input: {
  uid: string;
  pilot: WarmReconnectPilot;
}): Promise<string> {
  const assertExactAccount = async () => {
    const resolution = await resolveGoogleAccountTokens(
      input.uid,
      input.pilot.sender.profileId
    );
    const tokens = resolution.record?.tokens;
    const accountEmail = normalizeWarmReconnectEmail(tokens?.accountEmail || "");
    if (
      !resolution.profileMapped ||
      !resolution.record ||
      resolution.record.profileId !== input.pilot.sender.profileId ||
      resolution.record.accountId !== input.pilot.sender.accountId ||
      !tokens?.refreshToken ||
      !isWarmReconnectGmailSendScopeExact(tokens.scope) ||
      !accountEmail ||
      accountEmail !== input.pilot.sender.fromEmail
    ) {
      throw new ApiError(
        409,
        "The exact approved Google sending account must be reconnected."
      );
    }
  };
  await assertExactAccount();
  const accessToken = await getAccessTokenForUser(input.uid, undefined, {
    profileId: input.pilot.sender.profileId,
  });
  await assertExactAccount();
  if (!accessToken) throw new ApiError(409, "Google sending access is unavailable.");
  return accessToken;
}

export async function recordWarmReconnectSent(input: {
  claim: WarmReconnectExecutorClaim;
  providerMessageId: string;
  providerThreadId: string;
  correlationId: string;
  now: Date;
  db: Firestore;
}): Promise<{ complete: boolean }> {
  const pilotRef = input.db
    .collection(COLLECTIONS.pilots)
    .doc(input.claim.pilot.pilotId);
  const stateRef = pilotRef.collection(EXECUTOR_COLLECTION).doc(EXECUTOR_STATE_DOCUMENT);
  const receiptRef = pilotRef.collection(RECEIPT_COLLECTION).doc(input.claim.receiptId);
  const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
    input.claim.pilot,
    input.claim.recipient,
    input.claim.receiptId
  );
  const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
  const initialLockRef = initialPilotLockRef(
    input.db,
    input.claim.pilot.workspaceId
  );
  return input.db.runTransaction(async (transaction) => {
    const [
      pilotSnapshot,
      stateSnapshot,
      receiptSnapshot,
      ledgerSnapshot,
      initialLockSnapshot,
    ] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
      transaction.get(receiptRef),
      transaction.get(ledgerRef),
      transaction.get(initialLockRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, input.claim.pilot.pilotId);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const receipt = assertReceiptBoundToClaim(
      parseReceipt(receiptSnapshot),
      input.claim,
      pilot
    );
    const ledgerTransition = reconcileWarmReconnectInvitationTransition({
      existing: ledgerSnapshot.data(),
      expected: invitationBinding,
      target: "sent",
    });
    if (
      state.halted ||
      !ledgerTransition.ok ||
      ledgerTransition.action !== "transition" ||
      state.activeReceiptId !== receipt.receiptId ||
      receipt.status !== "provider_inflight" ||
      !asString(input.providerMessageId) ||
      !asString(input.providerThreadId)
    ) {
      throw new ApiError(409, "The provider receipt could not be reconciled.");
    }
    const sentCount = state.sentCount + 1;
    const complete = sentCount === WARM_RECONNECT_INITIAL_PILOT_SIZE;
    transaction.set(
      receiptRef,
      {
        status: "sent",
        providerMessageId: asString(input.providerMessageId),
        providerThreadId: asString(input.providerThreadId),
        sentAtMs: input.now.getTime(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      ledgerRef,
      {
        status: "sent",
        terminalAtMs: input.now.getTime(),
        correlationId: input.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      stateRef,
      {
        activeReceiptId: null,
        sentCount,
        complete,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      pilotRef
        .collection(EVENT_COLLECTION)
        .doc(eventId("provider_sent", receipt.receiptId, input.correlationId)),
      {
        kind: "provider_sent",
        pilotId: pilot.pilotId,
        workspaceId: pilot.workspaceId,
        receiptId: receipt.receiptId,
        correlationId: input.correlationId,
        approvalId: receipt.approvalId,
        actionFingerprint: receipt.actionFingerprint,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    return { complete };
  });
}

export async function recordWarmReconnectDeliveryUnknown(input: {
  claim: WarmReconnectExecutorClaim;
  correlationId: string;
  now: Date;
  db: Firestore;
  reason: string;
}): Promise<{ alreadySent: boolean }> {
  const pilotRef = input.db
    .collection(COLLECTIONS.pilots)
    .doc(input.claim.pilot.pilotId);
  const stateRef = pilotRef.collection(EXECUTOR_COLLECTION).doc(EXECUTOR_STATE_DOCUMENT);
  const receiptRef = pilotRef.collection(RECEIPT_COLLECTION).doc(input.claim.receiptId);
  const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
    input.claim.pilot,
    input.claim.recipient,
    input.claim.receiptId
  );
  const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
  const initialLockRef = initialPilotLockRef(
    input.db,
    input.claim.pilot.workspaceId
  );
  return input.db.runTransaction(async (transaction) => {
    const [
      pilotSnapshot,
      stateSnapshot,
      receiptSnapshot,
      ledgerSnapshot,
      initialLockSnapshot,
    ] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
      transaction.get(receiptRef),
      transaction.get(ledgerRef),
      transaction.get(initialLockRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, input.claim.pilot.pilotId);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const receipt = assertReceiptBoundToClaim(
      parseReceipt(receiptSnapshot),
      input.claim,
      pilot
    );
    const ledgerTransition = reconcileWarmReconnectInvitationTransition({
      existing: ledgerSnapshot.data(),
      expected: invitationBinding,
      target: "delivery_unknown",
    });
    if (!ledgerTransition.ok) {
      throw new ApiError(
        409,
        "The one-time invitation reservation could not be reconciled."
      );
    }
    if (
      receipt.status === "sent" &&
      ledgerTransition.action === "already_applied" &&
      ledgerTransition.alreadySent
    ) {
      return { alreadySent: true };
    }
    if (
      receipt.status === "delivery_unknown" &&
      ledgerTransition.action === "already_applied"
    ) {
      return { alreadySent: false };
    }
    if (
      receipt.status !== "provider_inflight" ||
      ledgerTransition.action !== "transition"
    ) {
      throw new ApiError(409, "The provider outcome could not be reconciled.");
    }
    transaction.set(
      ledgerRef,
      {
        status: "delivery_unknown",
        terminalAtMs: input.now.getTime(),
        correlationId: input.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    stopPilot(transaction, {
      pilotRef,
      stateRef,
      initialLockRef,
      initialLockData: initialLockSnapshot.data(),
      releaseInitialLock: false,
      pilot,
      state,
      receiptRef,
      receipt,
      reason: asString(input.reason) || "provider_outcome_ambiguous",
      correlationId: input.correlationId,
      now: input.now,
    });
    return { alreadySent: false };
  });
}

export async function recordWarmReconnectStoppedBeforeProvider(input: {
  claim: WarmReconnectExecutorClaim;
  correlationId: string;
  now: Date;
  db: Firestore;
  reason: string;
}): Promise<void> {
  const pilotRef = input.db
    .collection(COLLECTIONS.pilots)
    .doc(input.claim.pilot.pilotId);
  const stateRef = pilotRef.collection(EXECUTOR_COLLECTION).doc(EXECUTOR_STATE_DOCUMENT);
  const receiptRef = pilotRef.collection(RECEIPT_COLLECTION).doc(input.claim.receiptId);
  const invitationBinding = warmReconnectInvitationReservationBindingForPilot(
    input.claim.pilot,
    input.claim.recipient,
    input.claim.receiptId
  );
  const ledgerRef = invitationLedgerRef(input.db, invitationBinding);
  const initialLockRef = initialPilotLockRef(
    input.db,
    input.claim.pilot.workspaceId
  );
  await input.db.runTransaction(async (transaction) => {
    const [
      pilotSnapshot,
      stateSnapshot,
      receiptSnapshot,
      ledgerSnapshot,
      initialLockSnapshot,
    ] = await Promise.all([
      transaction.get(pilotRef),
      transaction.get(stateRef),
      transaction.get(receiptRef),
      transaction.get(ledgerRef),
      transaction.get(initialLockRef),
    ]);
    const pilot = pilotFromSnapshot(pilotSnapshot, input.claim.pilot.pilotId);
    assertOwnedActiveInitialPilotLock(initialLockSnapshot.data(), pilot);
    const state = parseExecutorState(stateSnapshot.data(), pilot);
    const receipt = assertReceiptBoundToClaim(
      parseReceipt(receiptSnapshot),
      input.claim,
      pilot
    );
    if (receipt.status === "sent" || receipt.status === "provider_inflight") {
      throw new ApiError(
        409,
        "A provider-started receipt cannot be classified as a pre-provider stop."
      );
    }
    const ledgerTransition = reconcileWarmReconnectInvitationTransition({
      existing: ledgerSnapshot.data(),
      expected: invitationBinding,
      target: "released_before_provider",
    });
    if (!ledgerTransition.ok) {
      throw new ApiError(
        409,
        "The one-time invitation reservation could not be reconciled."
      );
    }
    if (ledgerTransition.action === "transition") {
      transaction.set(
        ledgerRef,
        {
          status: "released_before_provider",
          releasedAtMs: input.now.getTime(),
          correlationId: input.correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    stopPilot(transaction, {
      pilotRef,
      stateRef,
      initialLockRef,
      initialLockData: initialLockSnapshot.data(),
      releaseInitialLock:
        state.lastProviderAttemptAtMs === null && state.sentCount === 0,
      pilot,
      state,
      receiptRef,
      receipt,
      reason: asString(input.reason) || "pre_provider_failure",
      correlationId: input.correlationId,
      now: input.now,
    });
  });
}

function defaultDependencies(): WarmReconnectExecutorDependencies {
  return {
    sendEnabled: isWarmReconnectProviderSendEnabled,
    claimNext: claimNextWarmReconnectRecipient,
    issueCapabilities: issueWarmReconnectPreferenceCapabilities,
    markCapabilitiesPrepared: markWarmReconnectCapabilitiesPrepared,
    beginProviderAttempt: beginWarmReconnectProviderAttempt,
    resolveAccessToken: resolveWarmReconnectGmailAccessToken,
    renderMessage: renderWarmReconnectEmail,
    sendMessage: sendWarmReconnectCampaignEmail,
    recordSent: recordWarmReconnectSent,
    recordDeliveryUnknown: recordWarmReconnectDeliveryUnknown,
    recordStoppedBeforeProvider: recordWarmReconnectStoppedBeforeProvider,
    loadCampaign: async ({ uid, log, db }) =>
      buildWarmReconnectCampaignDraft(
        await loadPortfolioCrmSummaryForUid(uid, log, db)
      ),
  };
}

export async function runWarmReconnectPilotExecutor(input: {
  uid: string;
  pilotId: string;
  correlationId: string;
  log: Logger;
  db?: Firestore;
  now?: Date;
  dependencies?: Partial<WarmReconnectExecutorDependencies>;
}): Promise<WarmReconnectExecutionResult> {
  const dependencies = {
    ...defaultDependencies(),
    ...(input.dependencies || {}),
  };
  if (!dependencies.sendEnabled()) {
    input.log.warn("crm.warm_reconnect.executor_disabled", {
      pilotId: input.pilotId,
      providerCalled: false,
    });
    return { ok: true, outcome: "disabled", providerCalled: false };
  }
  const db = input.db || getAdminDb();
  const now = input.now || new Date();
  const claimResult = await dependencies.claimNext({
    uid: input.uid,
    pilotId: input.pilotId,
    correlationId: input.correlationId,
    now,
    db,
  });
  if (claimResult.kind === "waiting") {
    return {
      ok: true,
      outcome: "waiting",
      providerCalled: false,
      retryAfterMs: claimResult.retryAfterMs,
    };
  }
  if (claimResult.kind === "busy" || claimResult.kind === "complete") {
    return { ok: true, outcome: claimResult.kind, providerCalled: false };
  }
  if (claimResult.kind === "stopped") {
    return {
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: claimResult.reason,
    };
  }

  const claim = claimResult.claim;
  const approval = claim.pilot.approval;
  const recipientDecisionId = claim.recipient.decision.decisionId;
  if (!approval || !recipientDecisionId) {
    throw new ApiError(409, "The exact campaign approval is missing.");
  }
  const capabilityExpiresAtMs = now.getTime() + WARM_RECONNECT_CAPABILITY_TTL_MS;
  let capabilities: Awaited<
    ReturnType<typeof issueWarmReconnectPreferenceCapabilities>
  >;
  try {
    capabilities = await dependencies.issueCapabilities(
      {
        workspaceId: claim.pilot.workspaceId,
        personId: claim.recipient.personId,
        contactPointId: claim.recipient.contactPointId,
        emailKey: claim.recipient.emailKey,
        legacyDncOrgId: claim.pilot.legacyDncOrgId,
        pilotId: claim.pilot.pilotId,
        recipientId: claim.recipient.recipientId,
        recipientDecisionId,
        campaignApprovalId: approval.approvalId,
        audienceFingerprint: claim.pilot.fingerprints.audienceFingerprint,
        artifactFingerprint: claim.pilot.fingerprints.artifactFingerprint,
        actionFingerprint: claim.pilot.fingerprints.actionFingerprint,
        capabilityExpiresAtMs,
      },
      db
    );
  } catch {
    await dependencies.recordStoppedBeforeProvider({
      claim,
      correlationId: input.correlationId,
      now: new Date(),
      db,
      reason: "capability_issuance_failed_before_provider",
    });
    return {
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: "capability_issuance_failed_before_provider",
    };
  }
  const preferenceDigest = digestWarmReconnectToken(capabilities.preferenceToken);
  const unsubscribeDigest = digestWarmReconnectToken(
    capabilities.unsubscribeOnlyToken
  );
  try {
    await dependencies.markCapabilitiesPrepared({
      claim,
      preferenceDigest,
      unsubscribeDigest,
      capabilityExpiresAtMs,
      correlationId: input.correlationId,
      now: new Date(),
      db,
    });
  } catch {
    await dependencies.recordStoppedBeforeProvider({
      claim,
      correlationId: input.correlationId,
      now: new Date(),
      db,
      reason: "capability_receipt_failed_before_provider",
    });
    return {
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: "capability_receipt_failed_before_provider",
    };
  }

  let rendered: ReturnType<typeof renderWarmReconnectEmail>;
  let accessToken: string;
  try {
    const campaign = await dependencies.loadCampaign({
      uid: input.uid,
      log: input.log,
      db,
    });
    if (
      campaign.review.previewFingerprint !==
      claim.pilot.campaignPreviewFingerprint
    ) {
      throw new ApiError(
        409,
        "The reviewed campaign preview changed before provider execution."
      );
    }
    const preferenceUrl = new URL(
      capabilities.preferenceFragment,
      claim.pilot.preferenceContract.origin
    ).toString();
    const unsubscribeUrl = new URL(
      capabilities.oneClickPath,
      claim.pilot.preferenceContract.origin
    ).toString();
    rendered = dependencies.renderMessage({
      campaign,
      firstName: claim.recipient.greetingName || null,
      senderName: claim.pilot.sender.senderName,
      legalEntity: claim.pilot.sender.legalEntity,
      physicalPostalAddress: claim.pilot.sender.physicalPostalAddress,
      preferencesUrl: preferenceUrl,
      unsubscribeUrl,
      publicOrigin: claim.pilot.preferenceContract.origin,
    });
    accessToken = await dependencies.resolveAccessToken({
      uid: input.uid,
      pilot: claim.pilot,
    });
  } catch {
    await dependencies.recordStoppedBeforeProvider({
      claim,
      correlationId: input.correlationId,
      now: new Date(),
      db,
      reason: "pre_provider_readiness_failed",
    });
    return {
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: "pre_provider_readiness_failed",
    };
  }

  const boundary = await dependencies.beginProviderAttempt({
    claim,
    preferenceDigest,
    unsubscribeDigest,
    correlationId: input.correlationId,
    now: new Date(),
    db,
  });
  if (!boundary.ready) {
    return {
      ok: true,
      outcome: "stopped",
      providerCalled: false,
      reason: boundary.reason,
    };
  }

  input.log.info("crm.warm_reconnect.provider_call_started", {
    pilotId: claim.pilot.pilotId,
    receiptId: claim.receiptId,
    approvalId: approval.approvalId,
    actionFingerprint: claim.pilot.fingerprints.actionFingerprint,
  });
  let providerResult: { id: string; threadId: string };
  try {
    providerResult = await dependencies.sendMessage(
      accessToken,
      {
        to: claim.email,
        from: claim.pilot.sender.fromEmail,
        senderName: claim.pilot.sender.senderName,
        replyTo: claim.pilot.sender.replyTo,
        subject: rendered.subject,
        plainText: rendered.plainText,
        html: rendered.html,
        messageId: deterministicMessageId(claim),
        preferencesUrl: new URL(
          capabilities.preferenceFragment,
          claim.pilot.preferenceContract.origin
        ).toString(),
        oneClickUnsubscribeUrl: new URL(
          capabilities.oneClickPath,
          claim.pilot.preferenceContract.origin
        ).toString(),
      },
      undefined
    );
  } catch {
    let reconciliationRequired = false;
    try {
      const reconciled = await dependencies.recordDeliveryUnknown({
        claim,
        correlationId: input.correlationId,
        now: new Date(),
        db,
        reason: "provider_outcome_ambiguous",
      });
      if (reconciled.alreadySent) {
        return {
          ok: true,
          outcome: "sent",
          providerCalled: true,
          receiptId: claim.receiptId,
          complete: false,
        };
      }
    } catch {
      reconciliationRequired = true;
    }
    input.log.warn("crm.warm_reconnect.provider_outcome_unknown", {
      pilotId: claim.pilot.pilotId,
      receiptId: claim.receiptId,
      reconciliationRequired,
      retryAllowed: false,
    });
    return {
      ok: true,
      outcome: "delivery_unknown",
      providerCalled: true,
      receiptId: claim.receiptId,
      reconciliationRequired,
    };
  }

  try {
    const recorded = await dependencies.recordSent({
      claim,
      providerMessageId: providerResult.id,
      providerThreadId: providerResult.threadId,
      correlationId: input.correlationId,
      now: new Date(),
      db,
    });
    input.log.info("crm.warm_reconnect.provider_receipt_recorded", {
      pilotId: claim.pilot.pilotId,
      receiptId: claim.receiptId,
      complete: recorded.complete,
    });
    return {
      ok: true,
      outcome: "sent",
      providerCalled: true,
      receiptId: claim.receiptId,
      complete: recorded.complete,
    };
  } catch {
    let reconciliationRequired = false;
    try {
      const reconciled = await dependencies.recordDeliveryUnknown({
        claim,
        correlationId: input.correlationId,
        now: new Date(),
        db,
        reason: "provider_receipt_persistence_ambiguous",
      });
      if (reconciled.alreadySent) {
        return {
          ok: true,
          outcome: "sent",
          providerCalled: true,
          receiptId: claim.receiptId,
          complete: false,
        };
      }
    } catch {
      reconciliationRequired = true;
    }
    input.log.warn("crm.warm_reconnect.provider_receipt_unknown", {
      pilotId: claim.pilot.pilotId,
      receiptId: claim.receiptId,
      reconciliationRequired,
      retryAllowed: false,
    });
    return {
      ok: true,
      outcome: "delivery_unknown",
      providerCalled: true,
      receiptId: claim.receiptId,
      reconciliationRequired,
    };
  }
}
