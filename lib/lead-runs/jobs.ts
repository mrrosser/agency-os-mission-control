import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";

export type LeadRunJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export interface LeadRunJobDiagnostics {
  sourceFetched: number;
  sourceScored: number;
  sourceFilteredByScore: number;
  sourceWithEmail: number;
  sourceWithoutEmail: number;
  processedLeads: number;
  failedLeads: number;
  calendarRetries: number;
  noEmail: number;
  noSlot: number;
  meetingsScheduled: number;
  meetingsDrafted: number;
  emailsSent: number;
  emailsDrafted: number;
  smsSent: number;
  callsPlaced: number;
  avatarsQueued: number;
  channelFailures: number;
}

export interface LeadRunJobConfig {
  dryRun: boolean;
  draftFirst: boolean;
  timeZone: string;
  useSMS: boolean;
  useAvatar: boolean;
  useOutboundCall: boolean;
  businessKey?: "aicf" | "rng" | "rts" | "rt";
}

export interface LeadRunJobDoc {
  runId: string;
  userId: string;
  orgId?: string;
  status: LeadRunJobStatus;
  config: LeadRunJobConfig;
  workerToken: string;
  leadDocIds: string[];
  nextIndex: number;
  totalLeads: number;
  diagnostics: LeadRunJobDiagnostics;
  attemptsByLead?: Record<string, number>;
  lastError?: string;
  leaseUntil?: string;
  correlationId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const LEAD_RUN_JOB_DOC_ID = "default";

export function defaultLeadRunDiagnostics(): LeadRunJobDiagnostics {
  return {
    sourceFetched: 0,
    sourceScored: 0,
    sourceFilteredByScore: 0,
    sourceWithEmail: 0,
    sourceWithoutEmail: 0,
    processedLeads: 0,
    failedLeads: 0,
    calendarRetries: 0,
    noEmail: 0,
    noSlot: 0,
    meetingsScheduled: 0,
    meetingsDrafted: 0,
    emailsSent: 0,
    emailsDrafted: 0,
    smsSent: 0,
    callsPlaced: 0,
    avatarsQueued: 0,
    channelFailures: 0,
  };
}

export function leadRunJobRef(runId: string) {
  return getAdminDb()
    .collection("lead_runs")
    .doc(runId)
    .collection("jobs")
    .doc(LEAD_RUN_JOB_DOC_ID);
}

export async function loadLeadRunJob(runId: string): Promise<LeadRunJobDoc | null> {
  const snap = await leadRunJobRef(runId).get();
  if (!snap.exists) return null;
  return snap.data() as LeadRunJobDoc;
}

export async function updateLeadRunJobHeartbeat(
  runId: string,
  status: LeadRunJobStatus,
  correlationId: string,
  log?: Logger
): Promise<void> {
  await leadRunJobRef(runId).set(
    {
      status,
      correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  log?.info("lead_runs.job.heartbeat", { runId, status });
}

export async function triggerLeadRunWorker(
  origin: string,
  runId: string,
  workerToken: string,
  correlationId: string,
  log?: Logger
): Promise<void> {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const queueId = process.env.LEAD_RUNS_TASK_QUEUE;
  const queueLocation = process.env.LEAD_RUNS_TASK_LOCATION;

  const useCloudTasks = Boolean(projectId && queueId && queueLocation);
  if (useCloudTasks) {
    try {
      const { CloudTasksClient } = await import("@google-cloud/tasks");
      const client = new CloudTasksClient();
      const parent = client.queuePath(projectId as string, queueLocation as string, queueId as string);
      const url = `${origin}/api/lead-runs/${encodeURIComponent(runId)}/jobs/worker`;
      const payload = Buffer.from(JSON.stringify({ workerToken })).toString("base64");

      const delaySeconds = Number.parseInt(process.env.LEAD_RUNS_TASK_DELAY_SECONDS || "0", 10);
      const scheduleTime =
        Number.isFinite(delaySeconds) && delaySeconds > 0
          ? {
              seconds: Math.floor(Date.now() / 1000) + delaySeconds,
            }
          : undefined;

      await client.createTask({
        parent,
        task: {
          scheduleTime,
          httpRequest: {
            httpMethod: "POST",
            url,
            headers: {
              "Content-Type": "application/json",
              "X-Correlation-Id": correlationId,
            },
            body: payload,
            oidcToken: process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT
              ? {
                  serviceAccountEmail: process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT,
                  audience: origin,
                }
              : undefined,
          },
        },
      });
      log?.info("lead_runs.job.worker_enqueued", {
        runId,
        dispatch: "cloud_tasks",
        queueId,
        queueLocation,
      });
      return;
    } catch (error) {
      log?.warn("lead_runs.job.cloud_tasks_dispatch_failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const url = `${origin}/api/lead-runs/${encodeURIComponent(runId)}/jobs/worker`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ workerToken }),
      cache: "no-store",
    });
    log?.info("lead_runs.job.worker_triggered", { runId, dispatch: "http" });
  } catch (error) {
    log?.warn("lead_runs.job.worker_trigger_failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
