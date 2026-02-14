import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";
import { ApiError } from "@/lib/api/handler";
import { withIdempotency } from "@/lib/api/idempotency";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createDraftEmail } from "@/lib/google/gmail";
import { buildLeadActionIdempotencyKey } from "@/lib/lead-runs/ids";
import { assertLeadRunOwner, recordLeadActionReceipt } from "@/lib/lead-runs/receipts";
import { findDncMatch, type DncEntry } from "@/lib/outreach/dnc";

export type FollowupTaskStatus = "pending" | "processing" | "completed" | "skipped" | "failed";

export type FollowupTask = {
  taskId: string;
  runId: string;
  leadDocId: string;
  uid: string;
  sequence: number;
  status: FollowupTaskStatus;
  dueAtMs: number;
  attempts: number;
  leaseUntilMs?: number | null;
  lastError?: string | null;
  lead: {
    companyName?: string;
    founderName?: string;
    email?: string;
    website?: string;
    industry?: string;
  };
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeActionDocId(actionId: string): string {
  return actionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export function computeFollowupTaskId(args: { runId: string; leadDocId: string; sequence: number }): string {
  return sha256(`${args.runId}:${args.leadDocId}:${args.sequence}`).slice(0, 32);
}

function tasksRef(runId: string) {
  return getAdminDb().collection("lead_runs").doc(runId).collection("followup_tasks");
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function listFollowupTasks(args: {
  runId: string;
  uid: string;
  limit?: number;
}): Promise<FollowupTask[]> {
  await assertLeadRunOwner(args.runId, args.uid);

  const limit = Math.min(Math.max(parsePositiveInt(args.limit, 50), 1), 200);
  const snap = await tasksRef(args.runId).orderBy("dueAtMs", "desc").limit(limit).get();

  return snap.docs.map((doc) => {
    const data = doc.data() as Partial<FollowupTask>;
    return {
      taskId: doc.id,
      runId: args.runId,
      leadDocId: String(data.leadDocId || ""),
      uid: String(data.uid || ""),
      sequence: Number(data.sequence || 1),
      status: (data.status as FollowupTaskStatus) || "pending",
      dueAtMs: Number(data.dueAtMs || 0),
      attempts: Number(data.attempts || 0),
      leaseUntilMs: typeof data.leaseUntilMs === "number" ? data.leaseUntilMs : null,
      lastError: (data.lastError as string | null | undefined) ?? null,
      lead: (data.lead as FollowupTask["lead"]) || {},
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      completedAt: data.completedAt,
    };
  });
}

export async function queueFollowupDraftTasksForRun(args: {
  runId: string;
  uid: string;
  delayHours: number;
  maxLeads: number;
  sequence?: number;
  log?: Logger;
}): Promise<{
  runId: string;
  created: number;
  existing: number;
  skippedNoEmail: number;
  skippedNoOutreach: number;
  dueAtMs: number;
}> {
  await assertLeadRunOwner(args.runId, args.uid, args.log);

  const sequence = typeof args.sequence === "number" && Number.isFinite(args.sequence) ? args.sequence : 1;
  const maxLeads = Math.min(Math.max(args.maxLeads || 25, 1), 25);
  const delayHours = Math.min(Math.max(args.delayHours || 48, 0), 24 * 30);
  const dueAtMs = Date.now() + delayHours * 60 * 60 * 1000;

  const leadsSnap = await getAdminDb()
    .collection("lead_runs")
    .doc(args.runId)
    .collection("leads")
    .limit(maxLeads)
    .get();

  let created = 0;
  let existing = 0;
  let skippedNoEmail = 0;
  let skippedNoOutreach = 0;

  for (const leadDoc of leadsSnap.docs) {
    const lead = (leadDoc.data() || {}) as Partial<FollowupTask["lead"]> & {
      email?: string;
      companyName?: string;
      founderName?: string;
      website?: string;
      industry?: string;
    };

    const email = String(lead.email || "").trim();
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    const actionsRef = leadDoc.ref.collection("actions");
    const [sentSnap, draftedSnap] = await Promise.all([
      actionsRef.doc(safeActionDocId("gmail.outreach")).get(),
      actionsRef.doc(safeActionDocId("gmail.outreach_draft")).get(),
    ]);

    const sentStatus = String(sentSnap.data()?.status || "");
    const draftedStatus = String(draftedSnap.data()?.status || "");
    const hasOutreach =
      (sentSnap.exists && (sentStatus === "complete" || sentStatus === "simulated")) ||
      (draftedSnap.exists && (draftedStatus === "complete" || draftedStatus === "simulated"));

    if (!hasOutreach) {
      skippedNoOutreach += 1;
      continue;
    }

    const taskId = computeFollowupTaskId({ runId: args.runId, leadDocId: leadDoc.id, sequence });
    const ref = tasksRef(args.runId).doc(taskId);

    const didCreate = await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      const now = FieldValue.serverTimestamp();
      tx.set(
        ref,
        {
          taskId,
          runId: args.runId,
          leadDocId: leadDoc.id,
          uid: args.uid,
          sequence,
          status: "pending" satisfies FollowupTaskStatus,
          dueAtMs,
          attempts: 0,
          leaseUntilMs: null,
          lastError: null,
          lead: {
            companyName: lead.companyName,
            founderName: lead.founderName,
            email,
            website: lead.website,
            industry: lead.industry,
          },
          updatedAt: now,
          createdAt: now,
        } satisfies Record<string, unknown>,
        { merge: false }
      );
      return true;
    });

    if (didCreate) created += 1;
    else existing += 1;
  }

  args.log?.info("outreach.followups.queued", {
    runId: args.runId,
    created,
    existing,
    skippedNoEmail,
    skippedNoOutreach,
    dueAtMs,
    delayHours,
  });

  return {
    runId: args.runId,
    created,
    existing,
    skippedNoEmail,
    skippedNoOutreach,
    dueAtMs,
  };
}

function dncMeta(dnc: DncEntry) {
  return { entryId: dnc.entryId, type: dnc.type, value: dnc.value };
}

function followupDraftHtml(args: {
  leadName: string;
  founderName: string;
  businessName: string;
  primaryService: string;
  companyName: string;
}): string {
  return `
    <h2>Hi ${args.leadName},</h2>
    <p>Just following up in case my last note got buried.</p>
    <p>If it’s helpful, I can send a quick 2-3 bullet plan for <strong>${args.companyName}</strong> on ${args.primaryService}.</p>
    <p>Open to a quick 15-minute call next week?</p>
    <br/>
    <p>Best regards,</p>
    <p>${args.founderName}<br/>${args.businessName}</p>
  `;
}

async function claimTaskForProcessing(args: {
  runId: string;
  uid: string;
  taskId: string;
  nowMs: number;
  leaseMs: number;
}): Promise<FollowupTask | null> {
  const ref = tasksRef(args.runId).doc(args.taskId);
  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as Partial<FollowupTask>;

    if (data.uid !== args.uid) return null;
    if (data.status !== "pending") return null;
    if (typeof data.dueAtMs !== "number" || data.dueAtMs > args.nowMs) return null;

    const leaseUntilMs = typeof data.leaseUntilMs === "number" ? data.leaseUntilMs : 0;
    if (leaseUntilMs && leaseUntilMs > args.nowMs) return null;

    tx.set(
      ref,
      {
        status: "processing",
        leaseUntilMs: args.nowMs + args.leaseMs,
        attempts: FieldValue.increment(1),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      taskId: snap.id,
      runId: args.runId,
      leadDocId: String(data.leadDocId || ""),
      uid: String(data.uid || ""),
      sequence: Number(data.sequence || 1),
      status: "processing",
      dueAtMs: Number(data.dueAtMs || 0),
      attempts: Number(data.attempts || 0) + 1,
      leaseUntilMs: args.nowMs + args.leaseMs,
      lastError: null,
      lead: (data.lead as FollowupTask["lead"]) || {},
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      completedAt: data.completedAt,
    };
  });
}

export async function processDueFollowupDraftTasks(args: {
  runId: string;
  orgId: string;
  uid: string;
  maxTasks: number;
  dryRun: boolean;
  log?: Logger;
}): Promise<{
  runId: string;
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
}> {
  await assertLeadRunOwner(args.runId, args.uid, args.log);

  const maxTasks = Math.min(Math.max(args.maxTasks || 5, 1), 25);
  const nowMs = Date.now();

  const accessToken = args.dryRun ? null : await getAccessTokenForUser(args.uid, args.log);
  if (!args.dryRun && !accessToken) {
    throw new ApiError(401, "Missing Google access token");
  }

  const identitySnap = await getAdminDb().collection("identities").doc(args.uid).get();
  const identity = identitySnap.data() || {};
  const founderName = String(identity.founderName || "Founder");
  const businessName = String(identity.businessName || "Mission Control");
  const primaryService = String(identity.primaryService || "growth support");

  const candidatesSnap = await tasksRef(args.runId).orderBy("dueAtMs", "asc").limit(100).get();
  const candidates = candidatesSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Partial<FollowupTask>) }))
    .filter((task) => task.uid === args.uid);

  let processed = 0;
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const task of candidates) {
    if (processed >= maxTasks) break;

    const dueAtMs = typeof task.dueAtMs === "number" ? task.dueAtMs : 0;
    const status = String(task.status || "");
    if (status !== "pending") continue;
    if (!dueAtMs || dueAtMs > nowMs) break;

    const claimed = await claimTaskForProcessing({
      runId: args.runId,
      uid: args.uid,
      taskId: String(task.id),
      nowMs,
      leaseMs: 90_000,
    });
    if (!claimed) continue;

    processed += 1;

    const leadEmail = String(claimed.lead.email || "").trim();
    const leadName = String(claimed.lead.founderName || "there");
    const companyName = String(claimed.lead.companyName || "your team");
    const leadWebsite = String(claimed.lead.website || "").trim();
    const emailDomain =
      leadEmail && leadEmail.includes("@") ? leadEmail.split("@")[1]?.trim() || null : null;

    const receiptKey = buildLeadActionIdempotencyKey({
      runId: args.runId,
      leadDocId: claimed.leadDocId,
      action: "gmail.followup-draft",
    });

    try {
      if (!leadEmail) {
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: claimed.leadDocId,
            actionId: "gmail.followup_draft",
            uid: args.uid,
            correlationId: args.runId,
            status: "skipped",
            dryRun: args.dryRun,
            replayed: false,
            idempotencyKey: receiptKey,
            data: { reason: "missing_email" },
          },
          args.log
        );
        skipped += 1;
        await tasksRef(args.runId).doc(claimed.taskId).set(
          {
            status: "skipped",
            leaseUntilMs: null,
            updatedAt: FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        continue;
      }

      let dnc = await findDncMatch({
        orgId: args.orgId,
        email: leadEmail,
        domain: emailDomain,
      });
      if (!dnc && leadWebsite) {
        dnc = await findDncMatch({ orgId: args.orgId, domain: leadWebsite });
      }
      if (dnc) {
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: claimed.leadDocId,
            actionId: "gmail.followup_draft",
            uid: args.uid,
            correlationId: args.runId,
            status: "skipped",
            dryRun: args.dryRun,
            replayed: false,
            idempotencyKey: receiptKey,
            data: { reason: "dnc", dnc: dncMeta(dnc) },
          },
          args.log
        );
        skipped += 1;
        await tasksRef(args.runId).doc(claimed.taskId).set(
          {
            status: "skipped",
            leaseUntilMs: null,
            updatedAt: FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        continue;
      }

      const subject = `Following up - ${companyName}`;
      const body = followupDraftHtml({
        leadName,
        founderName,
        businessName,
        primaryService,
        companyName,
      });

      if (args.dryRun) {
        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: claimed.leadDocId,
            actionId: "gmail.followup_draft",
            uid: args.uid,
            correlationId: args.runId,
            status: "simulated",
            dryRun: true,
            replayed: false,
            idempotencyKey: receiptKey,
            data: { subject },
          },
          args.log
        );
      } else {
        const draftResult = await withIdempotency(
          { uid: args.uid, route: "gmail.draft", key: receiptKey, log: args.log },
          () =>
            createDraftEmail(
              accessToken as string,
              {
                to: [leadEmail],
                subject,
                body,
                isHtml: true,
              },
              args.log
            )
        );

        await recordLeadActionReceipt(
          {
            runId: args.runId,
            leadDocId: claimed.leadDocId,
            actionId: "gmail.followup_draft",
            uid: args.uid,
            correlationId: args.runId,
            status: "complete",
            dryRun: false,
            replayed: draftResult.replayed,
            idempotencyKey: receiptKey,
            data: {
              draftId: draftResult.data?.draftId,
              messageId: draftResult.data?.messageId,
              threadId: draftResult.data?.threadId,
            },
          },
          args.log
        );
      }

      completed += 1;
      await tasksRef(args.runId).doc(claimed.taskId).set(
        {
          status: "completed",
          leaseUntilMs: null,
          updatedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed += 1;
      await tasksRef(args.runId).doc(claimed.taskId).set(
        {
          status: "failed",
          leaseUntilMs: null,
          lastError: message,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      args.log?.warn("outreach.followups.task_failed", {
        runId: args.runId,
        taskId: claimed.taskId,
        leadDocId: claimed.leadDocId,
        error: message,
      });
    }
  }

  args.log?.info("outreach.followups.worker_completed", {
    runId: args.runId,
    processed,
    completed,
    skipped,
    failed,
    dryRun: args.dryRun,
  });

  return { runId: args.runId, processed, completed, skipped, failed };
}
