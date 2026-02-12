import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { stripUndefined } from "@/lib/firestore/strip-undefined";

export type LeadActionStatus = "complete" | "error" | "skipped" | "simulated";

export interface LeadActionReceiptInput {
  runId: string;
  leadDocId: string;
  actionId: string;
  uid: string;
  correlationId: string;
  status: LeadActionStatus;
  dryRun?: boolean;
  replayed?: boolean;
  idempotencyKey?: string | null;
  data?: Record<string, unknown>;
}

function safeDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export async function assertLeadRunOwner(runId: string, uid: string, log?: Logger): Promise<void> {
  const runRef = getAdminDb().collection("lead_runs").doc(runId);
  const snap = await runRef.get();
  if (!snap.exists) {
    throw new ApiError(404, "Lead run not found");
  }

  const owner = snap.data()?.userId;
  if (owner !== uid) {
    log?.warn("lead_run.forbidden", { runId });
    throw new ApiError(403, "Forbidden");
  }
}

export async function recordLeadActionReceipt(input: LeadActionReceiptInput, log?: Logger): Promise<void> {
  await assertLeadRunOwner(input.runId, input.uid, log);

  const runRef = getAdminDb().collection("lead_runs").doc(input.runId);
  const actionRef = runRef
    .collection("leads")
    .doc(input.leadDocId)
    .collection("actions")
    .doc(safeDocId(input.actionId));

  const existing = await actionRef.get();
  const createdAt = existing.exists ? undefined : FieldValue.serverTimestamp();

  await actionRef.set(
    stripUndefined({
      actionId: input.actionId,
      runId: input.runId,
      leadDocId: input.leadDocId,
      userId: input.uid,
      correlationId: input.correlationId,
      status: input.status,
      dryRun: input.dryRun,
      replayed: input.replayed,
      idempotencyKey: input.idempotencyKey || undefined,
      data: input.data,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt,
    }) as Record<string, unknown>,
    { merge: true }
  );
}
