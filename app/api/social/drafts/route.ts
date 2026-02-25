import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import {
  createSocialDraftWithApprovalDispatch,
  listSocialDrafts,
  type SocialDraftStatus,
} from "@/lib/social/drafts";

const statusEnum = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "scheduled",
  "posted",
  "failed",
]);

const mediaSchema = z.object({
  type: z.enum(["image", "video"]),
  url: z.string().trim().url().max(2000),
  thumbnailUrl: z.string().trim().url().max(2000).optional(),
  title: z.string().trim().max(120).optional(),
});

const bodySchema = z.object({
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

function stableDraftIdempotencyKey(uid: string, body: z.infer<typeof bodySchema>): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        uid,
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
  return `social-draft-${digest.slice(0, 32)}`;
}

function resolveApprovalBaseUrl(request: { url: string; nextUrl?: { origin?: string } }): string {
  const configured = String(process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return (request.nextUrl?.origin || new URL(request.url).origin).replace(/\/+$/, "");
}

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const requestUrl = request.nextUrl || new URL(request.url);
    const statusRaw = String(requestUrl.searchParams.get("status") || "").trim();
    const status = statusRaw ? (statusEnum.parse(statusRaw) as SocialDraftStatus) : undefined;
    const limitRaw = Number.parseInt(String(requestUrl.searchParams.get("limit") || ""), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    const drafts = await listSocialDrafts({
      uid: user.uid,
      status,
      limit,
    });

    return NextResponse.json({
      ok: true,
      drafts,
      correlationId,
    });
  },
  { route: "social.drafts.list" }
);

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    const idempotencyKey =
      getIdempotencyKey(request, body) || stableDraftIdempotencyKey(user.uid, body);

    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "social.drafts.create",
        key: idempotencyKey,
        log,
      },
      async () =>
        createSocialDraftWithApprovalDispatch({
          uid: user.uid,
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
  { route: "social.drafts.create" }
);
