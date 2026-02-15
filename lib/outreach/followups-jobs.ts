import "server-only";

import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";
import { ApiError } from "@/lib/api/handler";
import { assertLeadRunOwner } from "@/lib/lead-runs/receipts";

function projectIdFromEnv(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    null
  );
}

function followupsTasksRef(runId: string) {
  return getAdminDb().collection("lead_runs").doc(runId).collection("followup_tasks");
}

function workerTokenField() {
  return "followupsWorkerToken";
}

export async function getOrCreateFollowupsWorkerToken(args: {
  runId: string;
  uid: string;
  log?: Logger;
}): Promise<string> {
  await assertLeadRunOwner(args.runId, args.uid, args.log);

  const runRef = getAdminDb().collection("lead_runs").doc(args.runId);
  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) throw new ApiError(404, "Lead run not found");

    const data = snap.data() || {};
    const existing = typeof data[workerTokenField()] === "string" ? String(data[workerTokenField()] || "").trim() : "";
    if (existing) return existing;

    const workerToken = randomUUID();
    tx.set(
      runRef,
      {
        [workerTokenField()]: workerToken,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    args.log?.info("outreach.followups.worker_token.created", { runId: args.runId });
    return workerToken;
  });
}

export async function findNextPendingFollowupDueAtMs(args: {
  runId: string;
  uid: string;
  lookahead?: number;
  log?: Logger;
}): Promise<number | null> {
  await assertLeadRunOwner(args.runId, args.uid, args.log);

  const lookahead = Math.min(Math.max(Number(args.lookahead || 50), 1), 200);
  const snap = await followupsTasksRef(args.runId).orderBy("dueAtMs", "asc").limit(lookahead).get();
  for (const doc of snap.docs) {
    const data = doc.data() as { uid?: unknown; status?: unknown; dueAtMs?: unknown };
    if (String(data.uid || "") !== args.uid) continue;
    if (String(data.status || "") !== "pending") continue;
    const dueAtMs = typeof data.dueAtMs === "number" ? data.dueAtMs : Number(data.dueAtMs || 0);
    if (!Number.isFinite(dueAtMs) || dueAtMs <= 0) continue;
    return dueAtMs;
  }
  return null;
}

function taskIdForSchedule(args: { runId: string; scheduleSeconds: number }): string {
  const digest = createHash("sha256").update(`${args.runId}:${args.scheduleSeconds}`).digest("hex").slice(0, 32);
  return `followups-${digest}`;
}

export async function triggerFollowupsWorker(args: {
  origin: string;
  runId: string;
  workerToken: string;
  correlationId: string;
  scheduleAtMs?: number;
  log?: Logger;
}): Promise<"cloud_tasks" | "http" | "skipped"> {
  const projectId = projectIdFromEnv();
  const queueId = process.env.FOLLOWUPS_TASK_QUEUE;
  const queueLocation = process.env.FOLLOWUPS_TASK_LOCATION;
  const serviceAccount = process.env.FOLLOWUPS_TASK_SERVICE_ACCOUNT;

  const delaySeconds = Number.parseInt(process.env.FOLLOWUPS_TASK_DELAY_SECONDS || "0", 10);
  const nowMs = Date.now();
  const scheduleAtMs =
    typeof args.scheduleAtMs === "number" && Number.isFinite(args.scheduleAtMs) ? args.scheduleAtMs : nowMs + Math.max(0, delaySeconds) * 1000;

  const useCloudTasks = Boolean(projectId && queueId && queueLocation);
  if (useCloudTasks) {
    try {
      const { CloudTasksClient } = await import("@google-cloud/tasks");
      const client = new CloudTasksClient();
      const parent = client.queuePath(projectId as string, queueLocation as string, queueId as string);

      const url = `${args.origin}/api/outreach/followups/worker-task`;
      const payload = Buffer.from(JSON.stringify({ runId: args.runId, workerToken: args.workerToken })).toString("base64");

      const scheduleSeconds = Math.floor(Math.max(scheduleAtMs, nowMs) / 1000);
      const name = client.taskPath(projectId as string, queueLocation as string, queueId as string, taskIdForSchedule({ runId: args.runId, scheduleSeconds }));

      await client.createTask({
        parent,
        task: {
          name,
          scheduleTime: { seconds: scheduleSeconds },
          httpRequest: {
            httpMethod: "POST",
            url,
            headers: {
              "Content-Type": "application/json",
              "X-Correlation-Id": args.correlationId,
            },
            body: payload,
            oidcToken: serviceAccount
              ? {
                  serviceAccountEmail: serviceAccount,
                  audience: args.origin,
                }
              : undefined,
          },
        },
      });

      args.log?.info("outreach.followups.worker_enqueued", {
        runId: args.runId,
        dispatch: "cloud_tasks",
        queueId,
        queueLocation,
        scheduleAtMs: scheduleSeconds * 1000,
      });
      return "cloud_tasks";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already exists")) {
        args.log?.info("outreach.followups.worker_enqueue_deduped", { runId: args.runId });
        return "cloud_tasks";
      }
      args.log?.warn("outreach.followups.worker_enqueue_failed", { runId: args.runId, error: message });
    }
  }

  // Local/dev fallback: only trigger immediately. If scheduling is required, skip to avoid tight loops.
  const scheduledInFuture = scheduleAtMs > nowMs + 5_000;
  if (scheduledInFuture) {
    args.log?.warn("outreach.followups.worker_trigger_skipped", {
      runId: args.runId,
      reason: "cloud_tasks_not_configured",
      scheduleAtMs,
    });
    return "skipped";
  }

  try {
    const url = `${args.origin}/api/outreach/followups/worker-task`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": args.correlationId,
      },
      body: JSON.stringify({ runId: args.runId, workerToken: args.workerToken }),
      cache: "no-store",
    });

    args.log?.info("outreach.followups.worker_triggered", { runId: args.runId, dispatch: "http" });
    return "http";
  } catch (error) {
    args.log?.warn("outreach.followups.worker_trigger_failed", {
      runId: args.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}

