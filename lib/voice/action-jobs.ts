import "server-only";

import { createHash } from "crypto";
import type { Logger } from "@/lib/logging";

type WorkerDispatch = "cloud_tasks" | "http" | "skipped";

function projectIdFromEnv(): string | null {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    null
  );
}

function queueConfig() {
  return {
    queueId:
      process.env.VOICE_ACTIONS_TASK_QUEUE ||
      process.env.FOLLOWUPS_TASK_QUEUE ||
      process.env.LEAD_RUNS_TASK_QUEUE ||
      null,
    queueLocation:
      process.env.VOICE_ACTIONS_TASK_LOCATION ||
      process.env.FOLLOWUPS_TASK_LOCATION ||
      process.env.LEAD_RUNS_TASK_LOCATION ||
      null,
    serviceAccount:
      process.env.VOICE_ACTIONS_TASK_SERVICE_ACCOUNT ||
      process.env.FOLLOWUPS_TASK_SERVICE_ACCOUNT ||
      process.env.LEAD_RUNS_TASK_SERVICE_ACCOUNT ||
      null,
  };
}

function taskIdForRequest(requestId: string): string {
  const digest = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  return `voice-actions-${digest}`;
}

export async function triggerVoiceActionsWorker(args: {
  origin: string;
  workerToken: string;
  correlationId: string;
  requestId?: string | null;
  log?: Logger;
}): Promise<WorkerDispatch> {
  const workerToken = args.workerToken.trim();
  if (!workerToken) {
    args.log?.warn("voice.actions.worker_trigger_skipped", {
      reason: "missing_worker_token",
    });
    return "skipped";
  }

  const projectId = projectIdFromEnv();
  const { queueId, queueLocation, serviceAccount } = queueConfig();
  const useCloudTasks = Boolean(projectId && queueId && queueLocation);
  const body = JSON.stringify({ workerToken });
  const workerUrl = `${args.origin}/api/twilio/voice-actions/worker-task`;

  if (useCloudTasks) {
    try {
      const { CloudTasksClient } = await import("@google-cloud/tasks");
      const client = new CloudTasksClient();
      const parent = client.queuePath(projectId as string, queueLocation as string, queueId as string);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const requestId = args.requestId?.trim() || `${args.correlationId}-${nowSeconds}`;
      const name = client.taskPath(
        projectId as string,
        queueLocation as string,
        queueId as string,
        taskIdForRequest(requestId)
      );

      await client.createTask({
        parent,
        task: {
          name,
          scheduleTime: { seconds: nowSeconds },
          httpRequest: {
            httpMethod: "POST",
            url: workerUrl,
            headers: {
              "Content-Type": "application/json",
              "X-Correlation-Id": args.correlationId,
            },
            body: Buffer.from(body).toString("base64"),
            oidcToken: serviceAccount
              ? {
                  serviceAccountEmail: serviceAccount,
                  audience: args.origin,
                }
              : undefined,
          },
        },
      });

      args.log?.info("voice.actions.worker_enqueued", {
        dispatch: "cloud_tasks",
        queueId,
        queueLocation,
        requestId,
      });
      return "cloud_tasks";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("already exists")) {
        args.log?.info("voice.actions.worker_enqueue_deduped", {
          requestId: args.requestId || null,
        });
        return "cloud_tasks";
      }
      args.log?.warn("voice.actions.worker_enqueue_failed", {
        error: message,
      });
    }
  }

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": args.correlationId,
      },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      args.log?.warn("voice.actions.worker_trigger_failed", {
        dispatch: "http",
        status: response.status,
      });
      return "skipped";
    }

    args.log?.info("voice.actions.worker_triggered", {
      dispatch: "http",
      requestId: args.requestId || null,
    });
    return "http";
  } catch (error) {
    args.log?.warn("voice.actions.worker_trigger_failed", {
      dispatch: "http",
      error: error instanceof Error ? error.message : String(error),
    });
    return "skipped";
  }
}
