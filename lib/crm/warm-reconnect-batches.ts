import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/handler";
import { WARM_RECONNECT_INITIAL_PILOT_SIZE, WARM_RECONNECT_MAX_PILOT_SIZE, type WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
import { resolveWarmReconnectCampaignContentMode } from "@/lib/crm/warm-reconnect-campaign-design";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { parseWarmReconnectInvitationLedgerDocument, warmReconnectInvitationBindingMatches, warmReconnectInvitationReservationBindingForPilot } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

export const WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION = "crm_warm_reconnect_campaign_locks";
export const WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION = "crm.warm-reconnect-follow-on-lock.v1";

type BatchShape = Pick<WarmReconnectPilot, "pilotId" | "tranche" | "recipientCap" | "parentPilotId" | "batchSequence" | "followOnNotBeforeMs">;
type Evidence = Record<string, unknown>;

export function assertWarmReconnectBatchShape(pilot: BatchShape): void {
  const valid = pilot.tranche === "initial_5"
    ? pilot.recipientCap === WARM_RECONNECT_INITIAL_PILOT_SIZE &&
      pilot.parentPilotId === undefined && pilot.batchSequence === undefined && pilot.followOnNotBeforeMs === undefined
    : pilot.tranche === "follow_on" && Number.isSafeInteger(pilot.recipientCap) &&
      pilot.recipientCap >= 1 && pilot.recipientCap <= WARM_RECONNECT_MAX_PILOT_SIZE &&
      typeof pilot.parentPilotId === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(pilot.parentPilotId) &&
      pilot.parentPilotId !== pilot.pilotId && Number.isSafeInteger(pilot.batchSequence) &&
      Number(pilot.batchSequence) >= 1 && Number.isSafeInteger(pilot.followOnNotBeforeMs) && Number(pilot.followOnNotBeforeMs) >= 0;
  if (!valid) throw new ApiError(409, "The exact batch size or predecessor binding is invalid.");
}

export function warmReconnectApprovalScopeForPilot(pilot: Pick<WarmReconnectPilot, "tranche">) {
  return pilot.tranche === "follow_on"
    ? "exact_batch_one_time_reconnection_emails" as const
    : "exact_five_one_time_reconnection_emails" as const;
}

export function warmReconnectFollowOnPilotLockId(workspaceId: string): string {
  return `wrfl_${warmReconnectFingerprint({
    contract: "warm-reconnect-follow-on-lock.v1", workspaceId,
    campaignId: WARM_RECONNECT_CAMPAIGN_ID, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
  }).slice(7, 47)}`;
}

function assertFollowOnLockShape(lock: Evidence, workspaceId: string): void {
  if (lock.schemaVersion !== WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION ||
      lock.workspaceId !== workspaceId || lock.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
      lock.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION || lock.tranche !== "follow_on" ||
      !["active", "released_before_provider"].includes(String(lock.state))) {
    throw new ApiError(409, "The follow-on campaign lock could not be reconciled.");
  }
}

export function assertOwnedWarmReconnectFollowOnLock(lock: Evidence | undefined, pilot: WarmReconnectPilot): void {
  assertWarmReconnectBatchShape(pilot);
  if (!lock) throw new ApiError(409, "The follow-on campaign lock is missing.");
  assertFollowOnLockShape(lock, pilot.workspaceId);
  if (lock.state !== "active" || lock.pilotId !== pilot.pilotId ||
      lock.parentPilotId !== pilot.parentPilotId || lock.batchSequence !== pilot.batchSequence ||
      lock.recipientCap !== pilot.recipientCap) {
    throw new ApiError(409, "The active follow-on batch changed. Reload the campaign desk.");
  }
}

/** Only the current completed chain head can gain a child. A released holder
 * requires separate durable no-provider proof before replacing this reservation. */
export function assertWarmReconnectFollowOnReservation(input: {
  lock: Evidence | undefined; parent: WarmReconnectPilot; proposed: WarmReconnectPilot;
}): void {
  const { lock, parent, proposed } = input;
  assertWarmReconnectBatchShape(parent);
  assertWarmReconnectBatchShape(proposed);
  if (proposed.tranche !== "follow_on" || proposed.parentPilotId !== parent.pilotId ||
      proposed.batchSequence !== (parent.batchSequence || 0) + 1 ||
      proposed.workspaceId !== parent.workspaceId || proposed.ownerUid !== parent.ownerUid) {
    throw new ApiError(409, "The follow-on batch must follow the exact completed predecessor.");
  }
  if (!lock) {
    if (parent.tranche !== "initial_5") throw new ApiError(409, "The follow-on chain head is missing.");
    return;
  }
  assertFollowOnLockShape(lock, parent.workspaceId);
  const sameReservation = lock.pilotId === proposed.pilotId && lock.parentPilotId === parent.pilotId &&
    lock.batchSequence === proposed.batchSequence && lock.recipientCap === proposed.recipientCap;
  const completedHead = parent.tranche === "follow_on" && lock.state === "active" &&
    lock.pilotId === parent.pilotId && lock.parentPilotId === parent.parentPilotId &&
    lock.batchSequence === parent.batchSequence && lock.recipientCap === parent.recipientCap;
  const releasedSibling = lock.state === "released_before_provider" &&
    lock.parentPilotId === parent.pilotId && lock.batchSequence === proposed.batchSequence;
  if (!sameReservation && !completedHead && !releasedSibling) {
    throw new ApiError(409, "Another follow-on batch owns this campaign. Review that exact batch.");
  }
}

export function assertWarmReconnectFollowOnContent(parent: WarmReconnectPilot, proposed: WarmReconnectPilot): void {
  const content = (pilot: WarmReconnectPilot) => ({
    sender: pilot.sender, contentMode: resolveWarmReconnectCampaignContentMode(pilot.contentMode),
    preview: pilot.campaignPreviewFingerprint, artwork: pilot.artworkEmailApproval,
    preference: pilot.preferenceContract, legacyDncOrgId: pilot.legacyDncOrgId,
  });
  if (warmReconnectFingerprint(content(parent)) !== warmReconnectFingerprint(content(proposed)) ||
      parent.fingerprints.artifactFingerprint !== proposed.fingerprints.artifactFingerprint) {
    throw new ApiError(409, "Follow-on batches must preserve the completed parent's exact approved message and sender.");
  }
}

export function warmReconnectBatchReceiptId(pilot: WarmReconnectPilot, recipientId: string): string {
  return `wre_${createHash("sha256").update(
    `warm-reconnect-delivery:v1|${pilot.workspaceId}|${pilot.pilotId}|${recipientId}|${pilot.fingerprints.actionFingerprint}`
  ).digest("hex").slice(0, 32)}`;
}

/** Caller must read all evidence in the same transaction that takes the lock. */
export function assertWarmReconnectParentCompletion(input: {
  parent: WarmReconnectPilot; state: Evidence | undefined;
  receipts: readonly Evidence[]; ledgers: readonly unknown[]; minimumCadenceMs: number;
}): { notBeforeMs: number } {
  const { parent, state, receipts, ledgers } = input;
  const fail = () => { throw new ApiError(409, "The predecessor needs complete, matching sent receipts and invitation ledger proof."); };
  assertWarmReconnectBatchShape(parent);
  if (parent.status !== "launch_requested" || !parent.launchRequestedAt || !parent.approval ||
      parent.approval.decision !== "approved" || parent.approval.approvalScope !== warmReconnectApprovalScopeForPilot(parent) ||
      Object.entries(parent.fingerprints).some(([key, value]) => parent.approval?.[key as keyof typeof parent.fingerprints] !== value) ||
      parent.recipients.length !== parent.recipientCap || !state ||
      state.schemaVersion !== "crm.warm-reconnect-executor-state.v1" || state.pilotId !== parent.pilotId ||
      state.workspaceId !== parent.workspaceId || state.complete !== true || state.halted !== false ||
      state.activeReceiptId !== null || state.sentCount !== parent.recipientCap || state.claimedCount !== parent.recipientCap ||
      receipts.length !== parent.recipientCap || ledgers.length !== parent.recipientCap ||
      !Number.isSafeInteger(state.lastProviderAttemptAtMs) || Number(state.lastProviderAttemptAtMs) < 1) fail();
  const byId = new Map(receipts.map(receipt => [receipt.receiptId, receipt]));
  if (byId.size !== parent.recipientCap ||
      new Set(receipts.map(receipt => receipt.providerMessageId)).size !== parent.recipientCap ||
      new Set(receipts.map(receipt => receipt.providerThreadId)).size !== parent.recipientCap) fail();
  let latestAttempt = 0;
  parent.recipients.forEach((recipient, index) => {
    const receiptId = warmReconnectBatchReceiptId(parent, recipient.recipientId);
    const receipt = byId.get(receiptId);
    const binding = warmReconnectInvitationReservationBindingForPilot(parent, recipient, receiptId);
    const ledger = parseWarmReconnectInvitationLedgerDocument(ledgers[index]);
    if (!receipt || receipt.schemaVersion !== "crm.warm-reconnect-delivery-receipt.v1" ||
        receipt.status !== "sent" || receipt.pilotId !== parent.pilotId || receipt.workspaceId !== parent.workspaceId ||
        receipt.ownerUid !== parent.ownerUid || receipt.recipientId !== recipient.recipientId ||
        receipt.personId !== recipient.personId || receipt.contactPointId !== recipient.contactPointId ||
        receipt.emailKey !== recipient.emailKey || receipt.approvalId !== parent.approval!.approvalId ||
        receipt.invitationReservationId !== binding.reservationId ||
        Object.entries(parent.fingerprints).some(([key, value]) => receipt[key] !== value) ||
        typeof receipt.providerMessageId !== "string" || !/^[a-f0-9]{1,64}$/.test(receipt.providerMessageId) ||
        typeof receipt.providerThreadId !== "string" || !/^[a-f0-9]{1,64}$/.test(receipt.providerThreadId) ||
        !Number.isSafeInteger(receipt.providerStartedAtMs) || Number(receipt.providerStartedAtMs) < 1 ||
        !Number.isSafeInteger(receipt.sentAtMs) || Number(receipt.sentAtMs) < Number(receipt.providerStartedAtMs) ||
        !ledger || ledger.status !== "sent" || !warmReconnectInvitationBindingMatches(ledger, binding) ||
        ledger.providerStartedAtMs !== receipt.providerStartedAtMs || ledger.terminalAtMs !== receipt.sentAtMs) fail();
    latestAttempt = Math.max(latestAttempt, Number(receipt!.providerStartedAtMs));
  });
  if (state!.lastProviderAttemptAtMs !== latestAttempt || !Number.isSafeInteger(input.minimumCadenceMs) || input.minimumCadenceMs < 60_000) fail();
  const notBeforeMs = latestAttempt + input.minimumCadenceMs;
  if (!Number.isSafeInteger(notBeforeMs) || state!.nextEligibleAtMs !== notBeforeMs) fail();
  return { notBeforeMs };
}
