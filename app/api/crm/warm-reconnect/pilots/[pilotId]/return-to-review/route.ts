import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { returnExpiredWarmReconnectPilotToReviewForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const id = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const bodySchema = z.object({
  expiredApprovalId: id,
  expectedArtifactFingerprint: fingerprint,
  expectedAudienceFingerprint: fingerprint,
  expectedActionFingerprint: fingerprint,
  reason: z.string().trim().min(1).max(500),
}).strict();
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
const returnToReview = withApiHandler(async ({ request, params, correlationId, log }) => {
  const user = await requireFirebaseAuth(request, log);
  if ([...new URL(request.url).searchParams.keys()].length) throw new ApiError(400, "Recovery does not accept query parameters.");
  const route = z.object({ pilotId: id }).strict().safeParse(params);
  if (!route.success) throw new ApiError(400, "Invalid pilot route.");
  const body = await parseBoundedWarmReconnectJson(request, bodySchema, 8 * 1024);
  const key = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/).safeParse(request.headers.get("x-idempotency-key"));
  if (!key.success) throw new ApiError(400, "Valid x-idempotency-key required.");
  const result = await returnExpiredWarmReconnectPilotToReviewForUid({
    uid: user.uid, pilotId: route.data.pilotId, request: body,
    correlationId, idempotencyKey: key.data, log,
  });
  return noStore(NextResponse.json({ schemaVersion: "crm.warm-reconnect-pilot-response.v1", providerAction: false, ...result }));
}, { route: "crm.warm_reconnect.return_to_review.post", persistServerErrors: false });
export async function POST(request: Parameters<typeof returnToReview>[0], context: Parameters<typeof returnToReview>[1]) {
  return noStore(await returnToReview(request, context));
}
