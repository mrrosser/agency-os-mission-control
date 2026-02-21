import "server-only";

import { createHash } from "crypto";
import type { Logger } from "@/lib/logging";

function projectIdFromEnv(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    null
  );
}

function taskIdForSchedule(args: {
  uid: string;
  monitorId: string;
  scheduleSeconds: number;
}): string {
  const digest = createHash("sha256")
    .update(`${args.uid}:${args.monitorId}:${args.scheduleSeconds}`)
    .digest("hex")
    .slice(0, 32);
  return `competitor-${digest}`;
}

export async function triggerCompetitorMonitorWorker(args: {
  origin: string;
  uid: string;
  monitorId: string;
  workerToken: string;
  correlationId: string;
  scheduleAtMs?: number;
  log?: Logger;
}): Promise<"cloud_tasks" | "http" | "skipped"> {
  const projectId = projectIdFromEnv();
  const queueId = process.env.COMPETITOR_MONITOR_TASK_QUEUE || process.env.LEAD_RUNS_TASK_QUEUE;
  const queueLocation =
    process.env.COMPETITOR_MONITOR_TASK_LOCATION || process.env.LEAD_RUNS_TASK_LOCATION;
  const serviceAccount =
    process.env.COMPETITOR_MONITOR_TASK_SERVICE_ACCOUNT ||
    process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT;

  const nowMs = Date.now();
  const scheduleAtMs =
    typeof args.scheduleAtMs === "number" && Number.isFinite(args.scheduleAtMs)
      ? args.scheduleAtMs
      : nowMs;
  const useCloudTasks = Boolean(projectId && queueId && queueLocation);

  if (useCloudTasks) {
    try {
      const { CloudTasksClient } = await import("@google-cloud/tasks");
      const client = new CloudTasksClient();
      const parent = client.queuePath(
        projectId as string,
        queueLocation as string,
        queueId as string
      );

      const payload = Buffer.from(
        JSON.stringify({
          uid: args.uid,
          monitorId: args.monitorId,
          workerToken: args.workerToken,
        })
      ).toString("base64");
      const scheduleSeconds = Math.floor(Math.max(scheduleAtMs, nowMs) / 1000);
      const name = client.taskPath(
        projectId as string,
        queueLocation as string,
        queueId as string,
        taskIdForSchedule({
          uid: args.uid,
          monitorId: args.monitorId,
          scheduleSeconds,
        })
      );

      await client.createTask({
        parent,
        task: {
          name,
          scheduleTime: { seconds: scheduleSeconds },
          httpRequest: {
            httpMethod: "POST",
            url: `${args.origin}/api/competitors/monitor/worker-task`,
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

      args.log?.info("competitor.monitor.worker.enqueued", {
        uid: args.uid,
        monitorId: args.monitorId,
        dispatch: "cloud_tasks",
        queueId,
        queueLocation,
        scheduleAtMs: scheduleSeconds * 1000,
      });
      return "cloud_tasks";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already exists")) {
        return "cloud_tasks";
      }
      args.log?.warn("competitor.monitor.worker.enqueue_failed", {
        uid: args.uid,
        monitorId: args.monitorId,
        error: message,
      });
    }
  }

  if (scheduleAtMs > nowMs + 5_000) {
    return "skipped";
  }

  try {
    await fetch(`${args.origin}/api/competitors/monitor/worker-task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": args.correlationId,
      },
      body: JSON.stringify({
        uid: args.uid,
        monitorId: args.monitorId,
        workerToken: args.workerToken,
      }),
      cache: "no-store",
    });
    return "http";
  } catch (error) {
    args.log?.warn("competitor.monitor.worker.http_failed", {
      uid: args.uid,
      monitorId: args.monitorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}
