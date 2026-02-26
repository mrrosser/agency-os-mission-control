import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { parseJson } from "@/lib/api/validation";
import { createSocialDraftWithApprovalDispatch } from "@/lib/social/drafts";
import { authorizeSocialDraftWorker } from "@/lib/social/worker-auth";

const mediaSchema = z.object({
  type: z.enum(["image", "video"]),
  url: z.string().trim().url().max(2000),
  thumbnailUrl: z.string().trim().url().max(2000).optional(),
  title: z.string().trim().max(120).optional(),
});

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  businessKey: z.enum(["aicf", "rng", "rts"]).default("aicf"),
  channels: z
    .array(z.enum(["instagram_story", "instagram_post", "facebook_story", "facebook_post"]))
    .min(1)
    .max(6),
  caption: z.string().trim().min(1).max(5000),
  media: z.array(mediaSchema).max(8).default([]),
  source: z.string().trim().min(1).max(80).default("agent_worker"),
  publishAt: z.string().datetime({ offset: true }).optional(),
  requestApproval: z.boolean().default(true),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

function stableDraftIdempotencyKey(body: z.infer<typeof bodySchema>): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        uid: body.uid,
        businessKey: body.businessKey,
        channels: [...body.channels].sort(),
        caption: body.caption,
        media: body.media.map((asset) => ({
          type: asset.type,
          url: asset.url,
          thumbnailUrl: asset.thumbnailUrl || null,
        })),
        publishAt: body.publishAt || null,
      })
    )
    .digest("hex");
  return `social-draft-worker-${digest.slice(0, 32)}`;
}

function resolveApprovalBaseUrl(request: { url: string; nextUrl?: { origin?: string } }): string {
  const configured = String(process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return (request.nextUrl?.origin || new URL(request.url).origin).replace(/\/+$/, "");
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSocialDraftWorker({ request, log, route: "social.drafts.worker_task.create" });
    const body = await parseJson(request, bodySchema);
    const idempotencyKey =
      getIdempotencyKey(request, body) || stableDraftIdempotencyKey(body);

    const result = await withIdempotency(
      {
        uid: body.uid,
        route: "social.drafts.worker_task.create",
        key: idempotencyKey,
        log,
      },
      async () =>
        createSocialDraftWithApprovalDispatch({
          uid: body.uid,
          businessKey: body.businessKey,
          channels: body.channels,
          caption: body.caption,
          media: body.media,
          source: body.source,
          publishAt: body.publishAt || null,
          correlationId,
          requestApproval: body.requestApproval,
          approvalBaseUrl: resolveApprovalBaseUrl(request),
          log,
        })
    );

    return NextResponse.json({
      ok: true,
      replayed: result.replayed,
      ...result.data,
      correlationId,
    });
  },
  { route: "social.drafts.worker_task.create" }
);
