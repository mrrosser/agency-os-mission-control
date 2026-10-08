import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { createWarmReconnectPilotForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const humanText = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const senderSchema = z
  .object({
    senderName: humanText(120),
    legalEntity: humanText(160),
    replyTo: z.string().trim().email().max(254),
    physicalPostalAddress: humanText(300),
    businessId: z.enum(["rosser_nft_gallery", "rt_solutions"]),
    profileId: z.enum(["rosser_gallery_send", "rt_solutions_send"]),
  })
  .strict()
  .superRefine((sender, context) => {
    const expected =
      sender.businessId === "rosser_nft_gallery"
        ? "rosser_gallery_send"
        : "rt_solutions_send";
    if (sender.profileId !== expected) {
      context.addIssue({
        code: "custom",
        path: ["profileId"],
        message: "Google business and profile must match",
      });
    }
  });
const commonFields = {
    idempotencyKey: identifier,
    campaignPreviewFingerprint: sha256,
    sender: senderSchema,
    contentMode: z.enum(["artwork_html", "plain_text", "preference_buttons", "approved_design_v2"]).optional(),
    artworkEmailApproval: z
      .object({
        approvedForThisEmailCampaign: z.literal(true),
        evidenceNote: humanText(500),
      })
      .strict().optional(),
};
const bodySchema = z.discriminatedUnion("tranche", [
  z.object({
    ...commonFields,
    tranche: z.literal("initial_5"),
    recipientCap: z.literal(5),
    candidateRecipientIds: z.tuple([identifier, identifier, identifier, identifier, identifier]),
  }).strict(),
  z.object({
    ...commonFields,
    tranche: z.literal("follow_on"),
    parentPilotId: z.string().regex(/^wrp_[a-f0-9]{32}$/),
    batchSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    recipientCap: z.number().int().min(1).max(10),
    candidateRecipientIds: z.array(identifier).min(1).max(10),
  }).strict(),
])
  .superRefine((body, context) => {
    if (body.candidateRecipientIds.length !== body.recipientCap ||
      new Set(body.candidateRecipientIds).size !== body.recipientCap) {
      context.addIssue({code: "custom", path: ["candidateRecipientIds"], message: "The exact batch size must match distinct recipient ids."});
    }
    const artworkMode = body.contentMode === "approved_design_v2" || (body.contentMode ?? "artwork_html") === "artwork_html";
    if (artworkMode ? !body.artworkEmailApproval : body.artworkEmailApproval !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["artworkEmailApproval"],
        message: "Artwork mode requires artwork approval; formats without artwork must omit it.",
      });
    }
  });

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

const postPilot = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "Warm reconnect pilot creation does not accept query parameters.");
    }
    const body = await parseBoundedWarmReconnectJson(request, bodySchema, 32 * 1024);
    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== body.idempotencyKey) {
      throw new ApiError(400, "x-idempotency-key must match the pilot idempotency key.");
    }
    const result = await createWarmReconnectPilotForUid({
      uid: user.uid,
      request: body,
      correlationId,
      log,
    });
    return noStore(
      NextResponse.json(
        {
          schemaVersion: "crm.warm-reconnect-pilot-response.v1",
          providerAction: false,
          ...result,
        },
        { status: result.replayed ? 200 : 201 }
      )
    );
  },
  { route: "crm.warm_reconnect.pilots.post", persistServerErrors: false }
);

export async function POST(
  request: Parameters<typeof postPilot>[0],
  context: Parameters<typeof postPilot>[1]
) {
  return noStore(await postPilot(request, context));
}
