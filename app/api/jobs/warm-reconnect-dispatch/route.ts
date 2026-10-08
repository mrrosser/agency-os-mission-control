import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { isWarmReconnectProviderSendEnabled } from "@/lib/crm/warm-reconnect-provider-config";
import { dispatchWarmReconnectBatch } from "@/lib/crm/warm-reconnect-dispatcher";
import { authorizeRevenueAutomationWorker, resolveRevenueAutomationWorkerUid } from "@/lib/revenue/worker-auth";

/** One recipient from the currently approved and launched follow-on batch per tick. */
export const POST = withApiHandler(async ({ request, correlationId, log }) => {
  const auth = await authorizeRevenueAutomationWorker({ request, correlationId, log });
  if (auth.mode !== "oidc") throw new ApiError(403, "Batch dispatch requires scheduler OIDC.");
  if (!isWarmReconnectProviderSendEnabled()) throw new ApiError(503, "Warm reconnect provider execution is disabled.");
  if ([...new URL(request.url).searchParams.keys()].length) throw new ApiError(400, "Batch dispatch does not accept query parameters.");
  await parseBoundedWarmReconnectJson(request, z.object({}).strict(), 1_024);
  const result = await dispatchWarmReconnectBatch({ uid: resolveRevenueAutomationWorkerUid(), correlationId, log });
  return NextResponse.json({ ...result, authMode: "oidc", correlationId });
}, { route: "crm.warm_reconnect.dispatch.post", persistServerErrors: false });
