import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { authorizeRevenueAutomationWorker, resolveRevenueAutomationWorkerUid } from "@/lib/revenue/worker-auth";
import type { Logger } from "@/lib/logging";

export function secureWarmReconnectQaJson(payload: unknown, status = 200) {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

/** OIDC is explicit and uses the existing exact scheduler principal/audience. */
export async function authorizeWarmReconnectQaOwner(input: { request: NextRequest; correlationId: string; log: Logger }): Promise<string> {
  if (new URL(input.request.url).search) throw new ApiError(400, "QA requests do not accept query parameters.");
  const mode = input.request.headers.get("x-warm-reconnect-auth");
  if (mode === "worker_oidc") {
    const authorization = await authorizeRevenueAutomationWorker(input);
    if (authorization.mode !== "oidc") throw new ApiError(403, "QA worker execution requires OIDC.");
    return resolveRevenueAutomationWorkerUid();
  }
  if (mode !== null) throw new ApiError(400, "Unknown QA authentication mode.");
  return (await requireFirebaseAuth(input.request, input.log)).uid;
}

export const WARM_RECONNECT_QA_UNAVAILABLE = {
  ok: true, testMode: true, message: "This test link does not change any real subscription.",
  available: false, expired: false, canUpdatePreferences: false, canUnsubscribe: false,
  globallyUnsubscribed: false, topics: { rosser_gallery: false, rt_solutions: false },
} as const;
