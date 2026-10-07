import "server-only";
import type { DocumentData, DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import type { WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
import { WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";
import { WARM_RECONNECT_INVITATION_LEDGER_COLLECTION, warmReconnectInvitationReservationId } from "@/lib/crm/warm-reconnect-invitation-ledger";

/** Call only in the transaction that reads and replaces the pilot document.
 * The dispatcher reads that pilot and writes these same execution documents.
 * Firestore retries either transaction on contention; all guards run again.
 */
export async function assertWarmReconnectNeverDispatched(input: {
  db: Firestore;
  transaction: Transaction;
  pilotRef: DocumentReference<DocumentData>;
  pilot: WarmReconnectPilot;
}): Promise<void> {
  const { db, transaction, pilotRef, pilot } = input;
  const ledgerRefs = pilot.recipients.map(recipient => db
    .collection(WARM_RECONNECT_INVITATION_LEDGER_COLLECTION)
    .doc(warmReconnectInvitationReservationId({
      workspaceId: pilot.workspaceId,
      campaignVersion: WARM_RECONNECT_CAMPAIGN_VERSION,
      personId: recipient.personId,
      emailKey: recipient.emailKey,
    })));
  const [executor, receipts, ...ledgers] = await Promise.all([
    transaction.get(pilotRef.collection("executor").doc("state")),
    // Any receipt, even one with an unexpected ID, makes recovery ineligible.
    transaction.get(pilotRef.collection("delivery_receipts").limit(1)),
    ...ledgerRefs.map(ref => transaction.get(ref)),
  ]);
  if (executor.exists || !receipts.empty || ledgers.some(snapshot => snapshot.exists)) {
    throw new ApiError(409, "Dispatch evidence exists. Reconcile it before any further campaign action.");
  }
}
