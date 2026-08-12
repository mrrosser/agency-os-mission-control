import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import {
  isWarmReconnectProviderSendEnabled,
  runWarmReconnectPilotExecutor,
} from "@/lib/crm/warm-reconnect-executor";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const requestSchema = z
  .object({
    pilotId: z.string().trim().regex(/^wrp_[a-f0-9]{32}$/),
  })
  .strict();

/**
 * Executes at most one approved recipient. No scheduler is installed by this
 * route, and the provider kill switch defaults to off.
 */
export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const authorization = await authorizeRevenueAutomationWorker({
      request,
      correlationId,
      log,
    });
    if (authorization.mode !== "oidc") {
      throw new ApiError(403, "Warm reconnect execution requires scheduler OIDC.");
    }
    if (!isWarmReconnectProviderSendEnabled()) {
      throw new ApiError(
        503,
        "Warm reconnect provider execution is disabled."
      );
    }
    const body = await parseBoundedWarmReconnectJson(request, requestSchema, 1_024);
    const uid = resolveRevenueAutomationWorkerUid();
    const result = await runWarmReconnectPilotExecutor({
      uid,
      pilotId: body.pilotId,
      correlationId,
      log,
    });
    return NextResponse.json({
      ...result,
      authMode: "oidc",
      correlationId,
    });
  },
  {
    route: "crm.warm_reconnect.executor.post",
    // Provider ambiguity is deliberately returned as a terminal 200 response;
    // unexpected route failures still must not persist error bodies containing
    // provider context.
    persistServerErrors: false,
  }
);
