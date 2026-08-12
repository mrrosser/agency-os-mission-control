import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { decideWarmReconnectRecipientForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const routeId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const evidenceRef = z.string().trim().min(1).max(300).regex(/^crm_source_records\/[A-Za-z0-9_-]+$/);
const note = z.string().trim().min(1).max(500);
const idempotencyKeySchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const bodySchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("attest_relationship"),
      expectedCandidateFingerprint: sha256,
      personallyRecognizedRelationship: z.literal(true),
      oneTimeReconnectionInvitationOnly: z.literal(true),
      sourceEvidenceRefs: z.array(evidenceRef).min(1).max(25),
      note,
    })
    .strict(),
  z
    .object({
      decision: z.literal("exclude"),
      expectedCandidateFingerprint: sha256,
      note,
    })
    .strict(),
]);

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

const postDecision = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "Recipient decisions do not accept query parameters.");
    }
    const parsedParams = z
      .object({ pilotId: routeId, recipientId: routeId })
      .strict()
      .safeParse(params);
    if (!parsedParams.success) throw new ApiError(400, "Invalid pilot recipient route.");
    const body = await parseBoundedWarmReconnectJson(request, bodySchema, 8 * 1024);
    const parsedKey = idempotencyKeySchema.safeParse(
      request.headers.get("x-idempotency-key")
    );
    if (!parsedKey.success) throw new ApiError(400, "Valid x-idempotency-key required.");
    const result = await decideWarmReconnectRecipientForUid({
      uid: user.uid,
      ...parsedParams.data,
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
  { route: "crm.warm_reconnect.recipient_decision.post", persistServerErrors: false }
);

export async function POST(
  request: Parameters<typeof postDecision>[0],
  context: Parameters<typeof postDecision>[1]
) {
  return noStore(await postDecision(request, context));
}
