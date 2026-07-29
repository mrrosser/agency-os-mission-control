import "server-only";

import type { Logger } from "@/lib/logging";

type Environment = Record<string, string | undefined>;

export type IntakeNotificationTriggerResult =
  | "disabled"
  | "triggered"
  | "failed";

function readWorkerUrl(environment: Environment): URL | null {
  const raw = environment.GALLERY_INTAKE_NOTIFICATION_WORKER_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) return null;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !==
      "/api/integrations/rosser-gallery/intake-notifications/worker"
  ) {
    return null;
  }
  return url;
}

export async function triggerIntakeNotificationWorker(args: {
  correlationId: string;
  log: Logger;
  environment?: Environment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<IntakeNotificationTriggerResult> {
  const environment = args.environment || process.env;
  const rawUrl = environment.GALLERY_INTAKE_NOTIFICATION_WORKER_URL?.trim();
  const token = environment.GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN?.trim();
  if (!rawUrl && !token) return "disabled";

  const url = readWorkerUrl(environment);
  if (!url || !token || token.length < 32) {
    args.log.warn("crm.intake_notification.trigger_misconfigured");
    return "failed";
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(10_000, Math.max(1_000, args.timeoutMs || 5_000))
  );
  try {
    const response = await (args.fetchImpl || fetch)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-correlation-id": args.correlationId,
      },
      body: JSON.stringify({ limit: 10, leaseSeconds: 90 }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      args.log.warn("crm.intake_notification.trigger_failed", {
        status: response.status,
      });
      return "failed";
    }
    args.log.info("crm.intake_notification.triggered", {
      status: response.status,
    });
    return "triggered";
  } catch (error) {
    args.log.warn("crm.intake_notification.trigger_failed", {
      reason: error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : "request_error",
    });
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}
