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
  requireBookingConfirmation?: boolean;
  timeZone: string;
  useSMS: boolean;
  useAvatar: boolean;
  useOutboundCall: boolean;
  businessKey?: "aicf" | "rng" | "rts" | "rt";
  businessUnit?: "ai_cofoundry" | "rosser_nft_gallery" | "rt_solutions";
  offerCode?: string;
}

export type LeadRunBusinessKey = NonNullable<LeadRunJobConfig["businessKey"]>;

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

/**
 * Lead-run provider writes do not yet have a durable per-action approval record.
 * Keep those boundaries draft-only until that approval workflow is available.
 * This is also applied by the worker so previously queued jobs cannot bypass it.
 */
export function enforceLeadRunApprovalGates(
  config: LeadRunJobConfig
): LeadRunJobConfig {
  return {
    ...config,
    draftFirst: true,
    requireBookingConfirmation: true,
    useSMS: false,
    useAvatar: false,
    useOutboundCall: false,
  };
}

export function hasUngatedLeadRunActions(config: LeadRunJobConfig): boolean {
  return (
    config.draftFirst !== true ||
    config.requireBookingConfirmation !== true ||
    config.useSMS === true ||
    config.useAvatar === true ||
    config.useOutboundCall === true
  );
}

export const LEAD_RUN_JOB_DOC_ID = "default";

const DEFAULT_GOOGLE_PROFILE_BY_BUSINESS_KEY: Record<string, string> = {
  rt: "rt_solutions_work",
  rts: "rt_solutions_work",
  rng: "rosser_gallery_work",
};

const BUSINESS_KEY_BY_BUSINESS_UNIT: Record<string, LeadRunBusinessKey> = {
  ai_cofoundry: "aicf",
  rosser_gallery: "rng",
  rosser_nft_gallery: "rng",
  rt_solutions: "rts",
};

const VALID_BUSINESS_KEYS = new Set<LeadRunBusinessKey>([
  "aicf",
  "rng",
  "rt",
  "rts",
]);

function canonicalBusinessKey(
  businessKey: LeadRunBusinessKey
): Exclude<LeadRunBusinessKey, "rt"> {
  return businessKey === "rt" ? "rts" : businessKey;
}

/**
 * Resolve the runtime business lane from a persisted job document.
 *
 * Non-empty unsupported or contradictory organization values must fail
 * closed instead of borrowing another Google profile. A completely absent
 * organization context returns null so callers can derive it from queued
 * tasks or preserve the historical legacy-token fallback.
 */
export function resolveLeadRunBusinessKey(
  config: Partial<LeadRunJobConfig> | null | undefined
): LeadRunBusinessKey | null {
  const rawBusinessKey = String(config?.businessKey || "").trim().toLowerCase();
  const rawBusinessUnit = String(config?.businessUnit || "").trim().toLowerCase();

  if (rawBusinessKey && !VALID_BUSINESS_KEYS.has(rawBusinessKey as LeadRunBusinessKey)) {
    throw new Error(`Unsupported lead-run businessKey '${rawBusinessKey}'`);
  }

  const businessKey = rawBusinessKey
    ? (rawBusinessKey as LeadRunBusinessKey)
    : null;
  const unitBusinessKey = rawBusinessUnit
    ? BUSINESS_KEY_BY_BUSINESS_UNIT[rawBusinessUnit] || null
    : null;

  if (rawBusinessUnit && !unitBusinessKey) {
    throw new Error(`Unsupported lead-run businessUnit '${rawBusinessUnit}'`);
  }

  if (
    businessKey &&
    unitBusinessKey &&
    canonicalBusinessKey(businessKey) !== canonicalBusinessKey(unitBusinessKey)
  ) {
    throw new Error(
      `Lead-run businessKey '${rawBusinessKey}' conflicts with businessUnit '${rawBusinessUnit}'`
    );
  }

  const resolved = businessKey || unitBusinessKey;
  return resolved || null;
}

export function resolveLeadRunGoogleProfileId(
  businessKey: LeadRunJobConfig["businessKey"]
): string | null {
  const normalized = String(businessKey || "").trim().toLowerCase();
  if (!normalized) return null;

  const envName = `LEAD_RUNS_GOOGLE_PROFILE_${normalized.toUpperCase()}`;
  const configured = String(process.env[envName] || "").trim().toLowerCase();
  return configured || DEFAULT_GOOGLE_PROFILE_BY_BUSINESS_KEY[normalized] || null;
}

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
  const region =
    process.env.FUNCTION_REGION ||
    process.env.GCLOUD_REGION ||
    process.env.GOOGLE_CLOUD_REGION ||
    process.env.LEAD_RUNS_TASK_LOCATION ||
    "us-central1";

  const normalizeWorkerOrigin = (value: string | undefined | null): string | null => {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!normalized) return null;
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      if (
        parsed.hostname === "0.0.0.0" ||
        parsed.hostname === "::" ||
        parsed.hostname === "[::]"
      ) {
        return null;
      }
      return normalized;
    } catch {
      return null;
    }
  };

  const derivedWorkerOrigin = projectId
    ? `https://${region}-${projectId}.cloudfunctions.net/ssrleadflowreview`
    : null;
  const cloudTasksOrigin =
    normalizeWorkerOrigin(process.env.LEAD_RUNS_WORKER_ORIGIN) ||
    normalizeWorkerOrigin(origin) ||
    normalizeWorkerOrigin(derivedWorkerOrigin);

  const useCloudTasks = Boolean(projectId && queueId && queueLocation && cloudTasksOrigin);
  if (useCloudTasks) {
    try {
      const { CloudTasksClient } = await import("@google-cloud/tasks");
      const client = new CloudTasksClient();
      const parent = client.queuePath(projectId as string, queueLocation as string, queueId as string);
      const url = `${cloudTasksOrigin}/api/lead-runs/${encodeURIComponent(runId)}/jobs/worker`;
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
                  audience: cloudTasksOrigin as string,
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

  const fallbackOrigins = new Set<string>();
  const addOrigin = (value: string | undefined | null) => {
    const normalized = normalizeWorkerOrigin(value);
    if (normalized) fallbackOrigins.add(normalized);
  };

  addOrigin(process.env.LEAD_RUNS_WORKER_ORIGIN);
  addOrigin(origin);
  addOrigin(derivedWorkerOrigin);
  if (process.env.VERCEL_URL) {
    addOrigin(`https://${process.env.VERCEL_URL}`);
  }

  for (const fallbackOrigin of fallbackOrigins) {
    const url = `${fallbackOrigin}/api/lead-runs/${encodeURIComponent(runId)}/jobs/worker`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify({ workerToken }),
        cache: "no-store",
      });
      if (!response.ok) {
        log?.warn("lead_runs.job.worker_trigger_http_failed", {
          runId,
          origin: fallbackOrigin,
          status: response.status,
        });
        continue;
      }
      log?.info("lead_runs.job.worker_triggered", {
        runId,
        dispatch: "http",
        origin: fallbackOrigin,
      });
      return;
    } catch (error) {
      log?.warn("lead_runs.job.worker_trigger_http_error", {
        runId,
        origin: fallbackOrigin,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log?.warn("lead_runs.job.worker_trigger_failed", {
    runId,
    attemptedOrigins: Array.from(fallbackOrigins),
  });
}
