import "server-only";

import { FieldPath, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import type { WarmReconnectActivationResponse, WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
import { assertWarmReconnectPilotFingerprints, canReleaseWarmReconnectInitialPilotLock, warmReconnectInitialPilotLockId, WARM_RECONNECT_EXECUTION_POLICY } from "@/lib/crm/warm-reconnect-activation";
import { assertWarmReconnectBatchShape, assertOwnedWarmReconnectFollowOnLock, assertWarmReconnectFollowOnContent, assertWarmReconnectParentCompletion, warmReconnectBatchReceiptId, warmReconnectFollowOnPilotLockId, WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION } from "@/lib/crm/warm-reconnect-batches";
import { parseWarmReconnectInvitationLedgerDocument, warmReconnectInvitationBindingMatches, warmReconnectInvitationReservationBindingForPilot, WARM_RECONNECT_INVITATION_LEDGER_COLLECTION } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

const PILOTS = "crm_warm_reconnect_pilots";
const LOCKS = "crm_warm_reconnect_campaign_locks";
export const WARM_RECONNECT_HISTORY_PAGE_SIZE = 20;
export const WARM_RECONNECT_INVITATION_REVIEW_LIMIT = 1000;
const PILOT_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

export function validateWarmReconnectHistoryCursor(value: string | undefined): string | undefined {
  if (value !== undefined && (!PILOT_ID.test(value) || value === "." || value === "..")) {
    throw new ApiError(400, "The history page cursor is invalid.");
  }
  return value;
}

function fail(message: string): never { throw new ApiError(409, message); }

/** A bounded display projection, never an execution authorization. Exact locks,
 * current documents and proof are read from one read-only Firestore snapshot.
 * History uses the existing equality filters and explicit document-ID ordering
 * (Firestore's default tie-break order), not a createdAt composite index. */
export async function loadWarmReconnectHistory(input: {
  db: Firestore; workspaceId: string; uid: string; historyAfter?: string;
}) {
  const { db, workspaceId, uid } = input;
  const after = validateWarmReconnectHistoryCursor(input.historyAfter);
  return db.runTransaction(async (transaction) => {
    const [initialSnapshot, followSnapshot] = await Promise.all([
      transaction.get(db.collection(LOCKS).doc(warmReconnectInitialPilotLockId(workspaceId))),
      transaction.get(db.collection(LOCKS).doc(warmReconnectFollowOnPilotLockId(workspaceId))),
    ]);
    const initial = initialSnapshot.data();
    const follow = followSnapshot.data();
    function validateLock(lock: DocumentData | undefined, tranche: "initial_5" | "follow_on") {
      if (!lock) return;
      if (lock.schemaVersion !== (tranche === "initial_5" ? 1 : WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION) ||
          lock.workspaceId !== workspaceId || lock.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
          lock.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION || lock.tranche !== tranche ||
          !["active", "released_before_provider"].includes(lock.state) ||
          typeof lock.pilotId !== "string" || !PILOT_ID.test(lock.pilotId)) fail("The campaign lock could not be reconciled.");
    }
    validateLock(initial, "initial_5");
    validateLock(follow, "follow_on");
    if (follow && (!initial || initial.state !== "active")) fail("The original campaign lock must remain active.");
    if (!follow) {
      const priorFollowOn = await transaction.get(db.collection(PILOTS)
        .where("workspaceId", "==", workspaceId).where("ownerUid", "==", uid)
        .where("tranche", "==", "follow_on").limit(1));
      if (priorFollowOn.size > 0) fail("Follow-on history exists without its authoritative campaign lock.");
    }

    const pilots = new Map<string, WarmReconnectPilot>();
    function checkedPilot(id: string, data: DocumentData | undefined): WarmReconnectPilot {
      if (!data || data.schemaVersion !== "crm.warm-reconnect-pilot.v1" || data.pilotId !== id ||
          data.workspaceId !== workspaceId || data.ownerUid !== uid) {
        fail("The campaign batch is missing or belongs to another owner.");
      }
      const pilot = data as WarmReconnectPilot;
      assertWarmReconnectBatchShape(pilot);
      assertWarmReconnectPilotFingerprints(pilot);
      if (pilot.recipients.length !== pilot.recipientCap) fail("The exact campaign audience changed.");
      return pilot;
    }
    async function readPilot(id: unknown): Promise<WarmReconnectPilot> {
      if (typeof id !== "string" || !PILOT_ID.test(id)) fail("The campaign batch reference is invalid.");
      if (pilots.has(id)) return pilots.get(id)!;
      const snapshot = await transaction.get(db.collection(PILOTS).doc(id));
      const pilot = checkedPilot(snapshot.id, snapshot.data());
      pilots.set(id, pilot);
      return pilot;
    }
    const initialPilot = initial ? await readPilot(initial.pilotId) : null;
    if (initialPilot && initialPilot.tranche !== "initial_5") fail("The initial campaign lock points to a different tranche.");
    const current = follow ? await readPilot(follow.pilotId) : initialPilot;
    let parent: WarmReconnectPilot | null = null;
    if (follow && current) {
      // Validate the same exact binding for active and released holders.
      assertOwnedWarmReconnectFollowOnLock({ ...follow, state: "active" }, current);
      parent = await readPilot(follow.parentPilotId);
      if (current.batchSequence !== (parent.batchSequence || 0) + 1 ||
          (parent.tranche === "initial_5" && parent.pilotId !== initialPilot?.pilotId)) fail("The follow-on predecessor binding changed.");
      assertWarmReconnectFollowOnContent(parent, current);
    }
    const control: WarmReconnectActivationResponse["control"] = {
      initialPilotId: initialPilot?.pilotId ?? null, activePilotId: null,
      followOnParentPilotId: null, canCreateInitialPilot: !initial, blockedReason: null,
    };
    const currentLock = follow || initial;
    if (current && currentLock) {
      if (currentLock.state === "released_before_provider") {
        await assertReleasedPilot({ db, transaction, pilot: current });
        if (follow && parent) {
          await assertCompletedPilot({ db, transaction, pilot: parent });
          control.followOnParentPilotId = parent.pilotId;
        } else control.canCreateInitialPilot = true;
      } else {
        const state = await transaction.get(db.collection(PILOTS).doc(current.pilotId).collection("executor").doc("state"));
        if (state.data()?.complete === true) {
          await assertCompletedPilot({ db, transaction, pilot: current });
          control.followOnParentPilotId = current.pilotId;
        } else {
          control.activePilotId = current.pilotId;
          if (["stopped", "rejected", "stale"].includes(current.status) || state.data()?.halted === true) {
            control.blockedReason = "The current batch still owns the campaign lock. Reconcile this batch before preparing another.";
          }
        }
      }
    }

    let query = db.collection(PILOTS).where("workspaceId", "==", workspaceId)
      .where("ownerUid", "==", uid).orderBy(FieldPath.documentId()).limit(WARM_RECONNECT_HISTORY_PAGE_SIZE + 1);
    if (after) query = query.startAfter(after);
    const [history, invitations] = await Promise.all([
      transaction.get(query),
      // Scan the entire bounded workspace ledger, so a malformed/missing campaign
      // version cannot disappear behind an equality filter. Other versions skip.
      transaction.get(db.collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION)
        .where("workspaceId", "==", workspaceId).limit(WARM_RECONNECT_INVITATION_REVIEW_LIMIT + 1)),
    ]);
    if (invitations.size > WARM_RECONNECT_INVITATION_REVIEW_LIMIT) fail("Invitation history exceeds the safe review bound. Reconcile it before selecting another audience.");
    const excludedPersonIds = new Set<string>();
    const excludedEmailKeys = new Set<string>();
    for (const row of invitations.docs) {
      const raw = row.data();
      if (typeof raw.campaignVersion === "string" && raw.campaignVersion && raw.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION) continue;
      const ledger = parseWarmReconnectInvitationLedgerDocument(raw);
      if (!ledger || ledger.workspaceId !== workspaceId || ledger.reservationId !== row.id) fail("Invitation history could not be reconciled.");
      if (ledger.status === "released_before_provider" && ledger.providerStartedAtMs === undefined && ledger.terminalAtMs === undefined) continue;
      excludedPersonIds.add(ledger.personId);
      excludedEmailKeys.add(ledger.emailKey);
    }
    const page = history.docs.slice(0, WARM_RECONNECT_HISTORY_PAGE_SIZE);
    for (const row of page) if (!pilots.has(row.id)) pilots.set(row.id, checkedPilot(row.id, row.data()));
    // History without its authoritative lock must not invite a replacement initial
    // audience. An empty page alone cannot prove that no prior campaign exists.
    if (!initial && (history.size > 0 || invitations.size > 0 || after)) {
      control.canCreateInitialPilot = false;
      control.blockedReason = "Campaign history exists without its original lock. Reconcile the campaign before preparing another batch.";
    }
    return {
      pilots: [...pilots.values()], control, excludedPersonIds, excludedEmailKeys,
      history: { pageSize: WARM_RECONNECT_HISTORY_PAGE_SIZE, after: after ?? null,
        nextCursor: history.size > WARM_RECONNECT_HISTORY_PAGE_SIZE ? page.at(-1)!.id : null,
        pilotIds: page.map(row => row.id) },
    };
  }, { readOnly: true });
}

async function executionEvidence(input: { db: Firestore; transaction: Transaction; pilot: WarmReconnectPilot }) {
  const { db, transaction, pilot } = input;
  const ref = db.collection(PILOTS).doc(pilot.pilotId);
  const [state, receipts, ...ledgers] = await Promise.all([
    transaction.get(ref.collection("executor").doc("state")),
    transaction.get(ref.collection("delivery_receipts").limit(pilot.recipientCap + 1)),
    ...pilot.recipients.map(recipient => transaction.get(db.collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION).doc(
      warmReconnectInvitationReservationBindingForPilot(pilot, recipient, warmReconnectBatchReceiptId(pilot, recipient.recipientId)).reservationId
    ))),
  ]);
  if (receipts.docs.some(row => row.id !== row.data().receiptId) || ledgers.some(row => row.exists && row.id !== row.data()?.reservationId)) fail("The batch receipt or invitation identity changed.");
  return { state: state.data(), receipts: receipts.docs.map(row => row.data()), ledgers: ledgers.map(row => row.data()) };
}

async function assertCompletedPilot(input: { db: Firestore; transaction: Transaction; pilot: WarmReconnectPilot }) {
  const evidence = await executionEvidence(input);
  assertWarmReconnectParentCompletion({ parent: input.pilot, ...evidence, minimumCadenceMs: WARM_RECONNECT_EXECUTION_POLICY.minimumCadenceMs });
}

async function assertReleasedPilot(input: { db: Firestore; transaction: Transaction; pilot: WarmReconnectPilot }) {
  const { pilot } = input;
  const { state, receipts, ledgers } = await executionEvidence(input);
  if (!["stopped", "rejected"].includes(pilot.status) ||
      (state && (state.schemaVersion !== "crm.warm-reconnect-executor-state.v1" || state.pilotId !== pilot.pilotId || state.workspaceId !== pilot.workspaceId || state.activeReceiptId != null)) ||
      !canReleaseWarmReconnectInitialPilotLock({ executorState: state, receipts, recipientCap: pilot.recipientCap }) ||
      receipts.some(receipt => receipt.status !== "stopped_before_provider" || receipt.pilotId !== pilot.pilotId ||
        receipt.workspaceId !== pilot.workspaceId || receipt.ownerUid !== pilot.ownerUid ||
        receipt.providerMessageId || receipt.providerThreadId || receipt.sentAtMs)) fail("The released batch has unresolved execution evidence.");
  ledgers.forEach((value, index) => {
    if (!value) return;
    const recipient = pilot.recipients[index];
    const receiptId = warmReconnectBatchReceiptId(pilot, recipient.recipientId);
    const receipt = receipts.find(row => row.receiptId === receiptId);
    const binding = warmReconnectInvitationReservationBindingForPilot(pilot, recipient, receiptId);
    binding.approvalId = typeof receipt?.approvalId === "string" ? receipt.approvalId : "";
    const ledger = parseWarmReconnectInvitationLedgerDocument(value);
    if (!receipt || receipt.recipientId !== recipient.recipientId || receipt.personId !== recipient.personId ||
        receipt.contactPointId !== recipient.contactPointId || receipt.emailKey !== recipient.emailKey ||
        receipt.invitationReservationId !== binding.reservationId ||
        Object.entries(pilot.fingerprints).some(([key, expected]) => receipt[key] !== expected) ||
        !ledger || ledger.status !== "released_before_provider" || !warmReconnectInvitationBindingMatches(ledger, binding) ||
        ledger.providerStartedAtMs !== undefined || ledger.terminalAtMs !== undefined) fail("The released batch still has a reserved or terminal invitation.");
  });
}
