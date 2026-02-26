import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runSocialDispatchWorker } from "@/lib/social/dispatch";
import { authorizeSocialDraftWorker } from "@/lib/social/worker-auth";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
  maxTasks: z.coerce.number().int().min(1).max(50).optional(),
  retryFailed: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

function resolveDefaultUid(): string {
  const candidates = [
    process.env.SOCIAL_DRAFT_UID,
    process.env.REVENUE_AUTOMATION_UID,
    process.env.REVENUE_DAY30_UID,
    process.env.REVENUE_DAY2_UID,
    process.env.REVENUE_DAY1_UID,
    process.env.VOICE_ACTIONS_DEFAULT_UID,
    process.env.SQUARE_WEBHOOK_DEFAULT_UID,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSocialDraftWorker({
      request,
      log,
      route: "social.drafts.dispatch.worker_task.post",
    });

    const body = await parseJson(request, bodySchema);
    const uid = String(body.uid || "").trim() || resolveDefaultUid();
    if (!uid) {
      throw new ApiError(
        400,
        "Missing uid. Provide uid in request body or configure SOCIAL_DRAFT_UID (or revenue uid fallback)."
      );
    }

    const result = await runSocialDispatchWorker({
      uid,
      maxTasks: body.maxTasks,
      retryFailed: body.retryFailed,
      dryRun: body.dryRun,
      correlationId,
      log,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
  },
  { route: "social.drafts.dispatch.worker_task.post" }
);
