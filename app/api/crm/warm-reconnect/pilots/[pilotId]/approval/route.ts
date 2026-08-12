import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { decideWarmReconnectPilotApprovalForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const routeId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const idempotencyKeySchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const common = {
  expectedArtifactFingerprint: sha256,
  expectedAudienceFingerprint: sha256,
  expectedActionFingerprint: sha256,
  note: z.string().trim().min(1).max(500),
};
const bodySchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("approve"),
      ...common,
      approvalScope: z.literal("exact_five_one_time_reconnection_emails"),
      confirmations: z
        .object({
          senderLegalIdentityVerified: z.literal(true),
          physicalPostalAddressVerified: z.literal(true),
          preferencesAndUnsubscribeVerified: z.literal(true),
          suppressionLedgerVerified: z.literal(true),
          spfDkimDmarcVerified: z.literal(true),
          replyToMonitored: z.literal(true),
          artworkApprovedForEmail: z.literal(true),
          exactAudienceReviewed: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z.object({ decision: z.literal("reject"), ...common }).strict(),
]);

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

const postApproval = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "Pilot approval does not accept query parameters.");
    }
    const parsedParams = z.object({ pilotId: routeId }).strict().safeParse(params);
    if (!parsedParams.success) throw new ApiError(400, "Invalid pilot route.");
    const body = await parseBoundedWarmReconnectJson(request, bodySchema, 8 * 1024);
    const parsedKey = idempotencyKeySchema.safeParse(
      request.headers.get("x-idempotency-key")
    );
    if (!parsedKey.success) throw new ApiError(400, "Valid x-idempotency-key required.");
    const result = await decideWarmReconnectPilotApprovalForUid({
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
  { route: "crm.warm_reconnect.approval.post", persistServerErrors: false }
);

export async function POST(
  request: Parameters<typeof postApproval>[0],
  context: Parameters<typeof postApproval>[1]
) {
  return noStore(await postApproval(request, context));
}
