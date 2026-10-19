import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { WARM_RECONNECT_MAX_PILOT_SIZE, type WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
import { assertWarmReconnectPilotFingerprints, canReleaseWarmReconnectInitialPilotLock, warmReconnectInitialPilotLockId, WARM_RECONNECT_EXECUTION_POLICY } from "@/lib/crm/warm-reconnect-activation";
import { assertWarmReconnectFollowOnContent, assertWarmReconnectFollowOnReservation, assertWarmReconnectParentCompletion, warmReconnectFollowOnPilotLockId, warmReconnectBatchReceiptId, WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION, WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION } from "@/lib/crm/warm-reconnect-batches";
import { WARM_RECONNECT_INVITATION_LEDGER_COLLECTION, parseWarmReconnectInvitationLedgerDocument, warmReconnectInvitationBindingMatches, warmReconnectInvitationReservationBindingForPilot } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { warmReconnectFingerprint } from "@/lib/crm/warm-reconnect-dedupe";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";

const PILOTS = "crm_warm_reconnect_pilots";
const MAX_IDENTITY_LEDGER_RECORDS = 100;

/** The exact-pair reservation remains authoritative. These bounded transactional
 * reads additionally block reused people/addresses after CRM identity changes. */
export async function assertWarmReconnectNoHistoricalInvitation(input: {
  db: Firestore; transaction: Transaction; pilot: WarmReconnectPilot;
  recipients?: WarmReconnectPilot["recipients"];
}): Promise<void> {
  for (const recipient of input.recipients || input.pilot.recipients) {
    const records = await Promise.all((["personId", "emailKey"] as const).map(field => input.transaction.get(
      input.db.collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION)
        .where("workspaceId", "==", input.pilot.workspaceId)
        .where(field, "==", recipient[field]).limit(MAX_IDENTITY_LEDGER_RECORDS + 1)
    )));
    if (records.some(result => result.size > MAX_IDENTITY_LEDGER_RECORDS || result.docs.some(doc => {
      const data = doc.data();
      // Other campaign versions do not share this one-time campaign contract.
      if (typeof data.campaignVersion === "string" && data.campaignVersion && data.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION) return false;
      const ledger = parseWarmReconnectInvitationLedgerDocument(data);
      return !ledger || ledger.reservationId !== doc.id || ledger.status !== "released_before_provider" ||
        ledger.providerStartedAtMs !== undefined || ledger.terminalAtMs !== undefined;
    }))) throw new ApiError(409, "A selected person or email already has an invitation or unresolved delivery.", { reason: "cross_batch_identity_invitation_conflict" });
  }
}

async function assertReleasedHolderNeverSent(input: {
  db: Firestore; transaction: Transaction; lock: DocumentData; parent: WarmReconnectPilot;
}): Promise<void> {
  const ref = input.db.collection(PILOTS).doc(String(input.lock.pilotId || "invalid"));
  const [snapshot, state, receipts] = await Promise.all([
    input.transaction.get(ref), input.transaction.get(ref.collection("executor").doc("state")),
    input.transaction.get(ref.collection("delivery_receipts").limit(WARM_RECONNECT_MAX_PILOT_SIZE + 1)),
  ]);
  const holder = snapshot.data() as WarmReconnectPilot | undefined;
  if (!holder || holder.pilotId !== snapshot.id || holder.pilotId !== input.lock.pilotId ||
      !["stopped", "rejected"].includes(holder.status) || holder.workspaceId !== input.parent.workspaceId ||
      holder.ownerUid !== input.parent.ownerUid || holder.parentPilotId !== input.parent.pilotId ||
      holder.batchSequence !== input.lock.batchSequence || holder.recipientCap !== input.lock.recipientCap ||
      !canReleaseWarmReconnectInitialPilotLock({ executorState: state.data(), receipts: receipts.docs.map(doc => doc.data()), recipientCap: holder.recipientCap }) ||
      receipts.docs.some(doc => {
        const receipt = doc.data();
        return doc.id !== receipt.receiptId || receipt.status !== "stopped_before_provider" ||
          receipt.pilotId !== holder.pilotId || receipt.workspaceId !== holder.workspaceId || receipt.ownerUid !== holder.ownerUid ||
          receipt.providerMessageId || receipt.providerThreadId || receipt.sentAtMs;
      })) throw new ApiError(409, "The released follow-on batch has unresolved execution evidence.");
  assertWarmReconnectPilotFingerprints(holder);
  const ledgers = await Promise.all(holder.recipients.map(recipient => input.transaction.get(
    input.db.collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION).doc(
      warmReconnectInvitationReservationBindingForPilot(holder, recipient, warmReconnectBatchReceiptId(holder, recipient.recipientId)).reservationId
    )
  )));
  if (ledgers.some((doc, index) => {
    if (!doc.exists) return false;
    const recipient = holder.recipients[index];
    const receiptId = warmReconnectBatchReceiptId(holder, recipient.recipientId);
    const receipt = receipts.docs.find(row => row.id === receiptId)?.data();
    const ledger = parseWarmReconnectInvitationLedgerDocument(doc.data());
    const binding = warmReconnectInvitationReservationBindingForPilot(holder, recipient, receiptId);
    // Stopping clears the active approval; the frozen receipt retains its ID.
    binding.approvalId = typeof receipt?.approvalId === "string" ? receipt.approvalId : "";
    return !receipt || receipt.recipientId !== recipient.recipientId || receipt.personId !== recipient.personId ||
      receipt.contactPointId !== recipient.contactPointId || receipt.emailKey !== recipient.emailKey ||
      receipt.invitationReservationId !== binding.reservationId ||
      Object.entries(holder.fingerprints).some(([key, value]) => receipt[key] !== value) ||
      !ledger || ledger.reservationId !== doc.id || ledger.status !== "released_before_provider" ||
      !warmReconnectInvitationBindingMatches(ledger, binding) ||
      ledger.providerStartedAtMs !== undefined || ledger.terminalAtMs !== undefined;
  })) {
    throw new ApiError(409, "The released follow-on batch still has a reserved or terminal invitation.");
  }
}

export async function reserveWarmReconnectFollowOnBatch(input: {
  db: Firestore; uid: string; workspaceId: string; pilotId: string; parentPilotId: string;
  correlationId: string; makePilot: (notBeforeMs: number) => WarmReconnectPilot;
}): Promise<{ pilot: WarmReconnectPilot; replayed: boolean }> {
  const ref = input.db.collection(PILOTS).doc(input.pilotId);
  const parentRef = input.db.collection(PILOTS).doc(input.parentPilotId);
  const lockRef = input.db.collection(WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION).doc(warmReconnectFollowOnPilotLockId(input.workspaceId));
  const initialRef = input.db.collection(WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION).doc(warmReconnectInitialPilotLockId(input.workspaceId));
  return input.db.runTransaction(async transaction => {
    const [existing, parentSnapshot, lockSnapshot, initialSnapshot] = await Promise.all([
      transaction.get(ref), transaction.get(parentRef), transaction.get(lockRef), transaction.get(initialRef),
    ]);
    const parent = parentSnapshot.data() as WarmReconnectPilot | undefined;
    if (!parent || parent.pilotId !== input.parentPilotId || parent.workspaceId !== input.workspaceId || parent.ownerUid !== input.uid) {
      throw new ApiError(409, "The completed predecessor was not found in this workspace.");
    }
    assertWarmReconnectPilotFingerprints(parent);
    const initial = initialSnapshot.data();
    if (!initial || initial.schemaVersion !== 1 || initial.state !== "active" || initial.tranche !== "initial_5" ||
        initial.workspaceId !== input.workspaceId || initial.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
        initial.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION ||
        (parent.tranche === "initial_5" && initial.pilotId !== parent.pilotId)) {
      throw new ApiError(409, "The original campaign lock must remain intact.");
    }
    const [state, receipts, ...ledgers] = await Promise.all([
      transaction.get(parentRef.collection("executor").doc("state")),
      transaction.get(parentRef.collection("delivery_receipts").limit(parent.recipientCap + 1)),
      ...parent.recipients.map(recipient => transaction.get(input.db.collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION).doc(
        warmReconnectInvitationReservationBindingForPilot(parent, recipient, warmReconnectBatchReceiptId(parent, recipient.recipientId)).reservationId
      ))),
    ]);
    if (receipts.docs.some(doc => doc.id !== doc.data().receiptId) ||
        ledgers.some(doc => !doc.exists || doc.id !== doc.data()?.reservationId)) {
      throw new ApiError(409, "The predecessor receipt or invitation document identity drifted.");
    }
    const proof = assertWarmReconnectParentCompletion({
      parent, state: state.data(), receipts: receipts.docs.map(doc => doc.data()),
      ledgers: ledgers.map(doc => doc.data()), minimumCadenceMs: WARM_RECONNECT_EXECUTION_POLICY.minimumCadenceMs,
    });
    const pilot = input.makePilot(proof.notBeforeMs);
    assertWarmReconnectFollowOnContent(parent, pilot);
    const creationIdentity = (value: WarmReconnectPilot) => warmReconnectFingerprint({
      workspaceId: value.workspaceId, ownerUid: value.ownerUid, artifact: value.fingerprints.artifactFingerprint,
      tranche: value.tranche, cap: value.recipientCap, parent: value.parentPilotId,
      sequence: value.batchSequence, notBefore: value.followOnNotBeforeMs,
      recipients: value.recipients.map(recipient => ({ recipientId: recipient.recipientId, candidateFingerprint: recipient.candidateFingerprint })),
    });
    if (existing.exists) {
      const stored = existing.data() as WarmReconnectPilot;
      assertWarmReconnectPilotFingerprints(stored);
      if (creationIdentity(stored) !== creationIdentity(pilot)) throw new ApiError(409, "This batch idempotency key was already used differently.");
      return { pilot: stored, replayed: true };
    }
    const lock = lockSnapshot.data();
    if (lock?.pilotId === pilot.pilotId) {
      throw new ApiError(409, "The reserved follow-on batch document is missing. Reconcile the existing lock.");
    }
    assertWarmReconnectFollowOnReservation({ lock, parent, proposed: pilot });
    if (lock?.state === "released_before_provider") await assertReleasedHolderNeverSent({ db: input.db, transaction, lock, parent });
    await assertWarmReconnectNoHistoricalInvitation({ db: input.db, transaction, pilot });
    const nextLock = {
      schemaVersion: WARM_RECONNECT_FOLLOW_ON_LOCK_SCHEMA_VERSION,
      workspaceId: input.workspaceId, campaignId: WARM_RECONNECT_CAMPAIGN_ID, campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      tranche: "follow_on", state: "active", pilotId: pilot.pilotId, parentPilotId: parent.pilotId,
      batchSequence: pilot.batchSequence, recipientCap: pilot.recipientCap,
      priorPilotId: lock?.pilotId || null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    // The initial lock, predecessor, receipts and ledgers are never rewritten.
    transaction.set(lockRef, nextLock);
    transaction.create(ref, pilot);
    transaction.create(ref.collection("events").doc(`created_${randomUUID()}`), {
      kind: "follow_on_batch_created", pilotId: pilot.pilotId, parentPilotId: parent.pilotId,
      workspaceId: input.workspaceId, batchSequence: pilot.batchSequence, recipientCap: pilot.recipientCap,
      correlationId: input.correlationId, ...pilot.fingerprints, createdAt: FieldValue.serverTimestamp(),
    });
    return { pilot, replayed: false };
  });
}
