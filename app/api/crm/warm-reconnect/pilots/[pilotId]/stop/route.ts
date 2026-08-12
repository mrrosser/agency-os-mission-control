import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { stopWarmReconnectPilotForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const routeId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const idempotencyKeySchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

const postStop = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "Pilot stop does not accept query parameters.");
    }
    const parsedParams = z.object({ pilotId: routeId }).strict().safeParse(params);
    if (!parsedParams.success) throw new ApiError(400, "Invalid pilot route.");
    const body = await parseBoundedWarmReconnectJson(request, bodySchema, 4 * 1024);
    const parsedKey = idempotencyKeySchema.safeParse(
      request.headers.get("x-idempotency-key")
    );
    if (!parsedKey.success) throw new ApiError(400, "Valid x-idempotency-key required.");
    const result = await stopWarmReconnectPilotForUid({
      uid: user.uid,
      pilotId: parsedParams.data.pilotId,
      request: body,
      correlationId,
      idempotencyKey: parsedKey.data,
      log,
    });
    return noStore(
      NextResponse.json({
        schemaVersion: "crm.warm-reconnect-pilot-response.v1",
        providerAction: false,
        ...result,
      })
    );
  },
  { route: "crm.warm_reconnect.stop.post", persistServerErrors: false }
);

export async function POST(
  request: Parameters<typeof postStop>[0],
  context: Parameters<typeof postStop>[1]
) {
  return noStore(await postStop(request, context));
}
