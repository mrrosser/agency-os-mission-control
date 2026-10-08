import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { warmReconnectFollowOnPilotLockId, WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION } from "@/lib/crm/warm-reconnect-batches";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";
import { runWarmReconnectPilotExecutor } from "@/lib/crm/warm-reconnect-executor";

type Target = { outcome: "idle" | "awaiting_launch" | "complete" | "inactive"; pilotId?: string } | { outcome: "ready"; pilotId: string };

/** Select only the server-owned follow-on lock. This cannot select or approve an audience. */
export async function resolveWarmReconnectDispatchTarget(uid: string, db: Firestore): Promise<Target> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new ApiError(400, "Invalid worker identity.");
  const workspaceId = `workspace_default_${uid}`;
  const lockSnapshot = await db.collection(WARM_RECONNECT_CAMPAIGN_LOCK_COLLECTION)
    .doc(warmReconnectFollowOnPilotLockId(workspaceId)).get();
  if (!lockSnapshot.exists) return { outcome: "idle" };
  const lock = lockSnapshot.data();
  if (!lock || lock.schemaVersion !== "crm.warm-reconnect-follow-on-lock.v1" ||
    lock.workspaceId !== workspaceId || lock.campaignId !== WARM_RECONNECT_CAMPAIGN_ID ||
    lock.campaignVersion !== WARM_RECONNECT_CAMPAIGN_VERSION || lock.tranche !== "follow_on" ||
    !/^wrp_[a-f0-9]{32}$/.test(lock.pilotId ?? "") ||
    !/^wrp_[a-f0-9]{32}$/.test(lock.parentPilotId ?? "") ||
    !Number.isSafeInteger(lock.batchSequence) || lock.batchSequence < 1 ||
    !Number.isSafeInteger(lock.recipientCap) || lock.recipientCap < 1 || lock.recipientCap > 10 ||
    !["active", "released_before_provider"].includes(lock.state)) {
    throw new ApiError(409, "The follow-on dispatch lock is invalid.");
  }
  if (lock.state !== "active") return { outcome: "inactive", pilotId: lock.pilotId };
  const pilotRef = db.collection("crm_warm_reconnect_pilots").doc(lock.pilotId);
  const pilotSnapshot = await pilotRef.get();
  const pilot = pilotSnapshot.data();
  if (!pilotSnapshot.exists || !pilot || pilot.pilotId !== lock.pilotId ||
    pilot.ownerUid !== uid || pilot.workspaceId !== workspaceId || pilot.tranche !== "follow_on" ||
    pilot.parentPilotId !== lock.parentPilotId || pilot.batchSequence !== lock.batchSequence ||
    pilot.recipientCap !== lock.recipientCap || !Array.isArray(pilot.recipients) ||
    pilot.recipients.length !== lock.recipientCap) {
    throw new ApiError(409, "The active batch does not match its dispatch lock.");
  }
  if (["stopped", "stale", "rejected"].includes(pilot.status)) return { outcome: "inactive", pilotId: pilot.pilotId };
  if (pilot.status !== "launch_requested") return { outcome: "awaiting_launch", pilotId: pilot.pilotId };
  const stateSnapshot = await pilotRef.collection("executor").doc("state").get();
  const state = stateSnapshot.data();
  if (state?.complete === true && state.pilotId === pilot.pilotId && state.workspaceId === workspaceId &&
    state.sentCount === pilot.recipientCap && state.claimedCount === pilot.recipientCap &&
    state.activeReceiptId === null && state.halted === false) {
    return { outcome: "complete", pilotId: pilot.pilotId };
  }
  return { outcome: "ready", pilotId: pilot.pilotId };
}

export async function dispatchWarmReconnectBatch(input: {
  uid: string; correlationId: string; log: Logger; db?: Firestore;
  dependencies?: {
    resolveTarget: typeof resolveWarmReconnectDispatchTarget;
    execute: typeof runWarmReconnectPilotExecutor;
  };
}) {
  const db = input.db ?? getAdminDb();
  const resolveTarget = input.dependencies?.resolveTarget ?? resolveWarmReconnectDispatchTarget;
  const execute = input.dependencies?.execute ?? runWarmReconnectPilotExecutor;
  const target = await resolveTarget(input.uid, db);
  if (target.outcome !== "ready") return { ok: true as const, ...target, providerCalled: false as const };
  // The executor re-reads lock, approval, suppression, cadence and durable claims.
  // A changed lock or ambiguous receipt cannot be advanced by this coordinator.
  const result = await execute({ uid: input.uid, pilotId: target.pilotId, correlationId: input.correlationId, log: input.log, db });
  return { ...result, pilotId: target.pilotId };
}
