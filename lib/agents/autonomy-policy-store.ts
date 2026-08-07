import { randomUUID } from "node:crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  createDefaultAutonomyPolicy,
  normalizeAutonomyPolicy,
  type AgentExecutionEnvelope,
  type AutonomyMode,
  type AutonomyPolicy,
} from "@/lib/agents/autonomy-policy";

const COLLECTION = "agentAutonomyPolicies";
const HISTORY_COLLECTION = "history";

export interface AutonomyPolicyAuditEntry {
  auditId: string;
  uid: string;
  actorUid: string;
  correlationId: string;
  beforeVersion: number;
  afterVersion: number;
  before: Pick<AutonomyPolicy, "globalKillSwitch" | "businessModes">;
  after: Pick<AutonomyPolicy, "globalKillSwitch" | "businessModes">;
  executionEnvelope: AgentExecutionEnvelope;
  changedAt: string;
}

export class AutonomyPolicyVersionConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super("Autonomy policy version conflict");
    this.name = "AutonomyPolicyVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

function policyRef(uid: string) {
  return getAdminDb().collection(COLLECTION).doc(uid);
}

function normalizeAuditEntry(value: unknown): AutonomyPolicyAuditEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.auditId !== "string" ||
    typeof row.uid !== "string" ||
    typeof row.actorUid !== "string" ||
    typeof row.correlationId !== "string" ||
    typeof row.changedAt !== "string"
  ) {
    return null;
  }
  return row as unknown as AutonomyPolicyAuditEntry;
}

export async function getAutonomyPolicy(uid: string): Promise<AutonomyPolicy> {
  const snapshot = await policyRef(uid).get();
  return snapshot.exists
    ? normalizeAutonomyPolicy(uid, snapshot.data())
    : createDefaultAutonomyPolicy(uid);
}

export async function listAutonomyPolicyAudit(
  uid: string,
  limit: number = 25
): Promise<AutonomyPolicyAuditEntry[]> {
  const snapshot = await policyRef(uid)
    .collection(HISTORY_COLLECTION)
    .orderBy("changedAt", "desc")
    .limit(Math.max(1, Math.min(50, Math.floor(limit))))
    .get();

  return snapshot.docs
    .map((document) => normalizeAuditEntry(document.data()))
    .filter((entry): entry is AutonomyPolicyAuditEntry => Boolean(entry));
}

export async function updateAutonomyPolicy(input: {
  uid: string;
  actorUid: string;
  expectedVersion: number;
  globalKillSwitch: boolean;
  businessModes: {
    rt_solutions: AutonomyMode;
    rosser_gallery: AutonomyMode;
  };
  executionEnvelope: AgentExecutionEnvelope;
  correlationId: string;
  log: Logger;
}): Promise<{ policy: AutonomyPolicy; auditId: string }> {
  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(input.uid);
  const auditId = randomUUID();
  const changedAt = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists
      ? normalizeAutonomyPolicy(input.uid, snapshot.data())
      : createDefaultAutonomyPolicy(input.uid);

    if (current.version !== input.expectedVersion) {
      throw new AutonomyPolicyVersionConflictError(
        input.expectedVersion,
        current.version
      );
    }

    const next: AutonomyPolicy = {
      uid: input.uid,
      version: current.version + 1,
      globalKillSwitch: input.globalKillSwitch,
      businessModes: {
        rt_solutions: input.businessModes.rt_solutions,
        rosser_gallery: input.businessModes.rosser_gallery,
      },
      updatedAt: changedAt,
      updatedByUid: input.actorUid,
    };

    const audit: AutonomyPolicyAuditEntry = {
      auditId,
      uid: input.uid,
      actorUid: input.actorUid,
      correlationId: input.correlationId,
      beforeVersion: current.version,
      afterVersion: next.version,
      before: {
        globalKillSwitch: current.globalKillSwitch,
        businessModes: current.businessModes,
      },
      after: {
        globalKillSwitch: next.globalKillSwitch,
        businessModes: next.businessModes,
      },
      executionEnvelope: input.executionEnvelope,
      changedAt,
    };

    transaction.set(ref, next);
    transaction.set(ref.collection(HISTORY_COLLECTION).doc(auditId), audit);

    return { policy: next, auditId };
  });

  input.log.info("agents.autonomy_policy.persisted", {
    uid: input.uid,
    actorUid: input.actorUid,
    version: result.policy.version,
    auditId: result.auditId,
    globalKillSwitch: result.policy.globalKillSwitch,
    rtSolutionsMode: result.policy.businessModes.rt_solutions,
    rosserGalleryMode: result.policy.businessModes.rosser_gallery,
  });

  return result;
}
