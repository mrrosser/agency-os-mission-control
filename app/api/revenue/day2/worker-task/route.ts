import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128),
  templateIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  dryRun: z.boolean().optional(),
  forceRun: z.boolean().optional(),
  dateKey: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  autoQueueFollowups: z.boolean().optional(),
  followupDelayHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
  followupMaxLeads: z.coerce.number().int().min(1).max(25).optional(),
  followupSequence: z.coerce.number().int().min(1).max(10).optional(),
  processDueResponses: z.boolean().optional(),
  responseLoopMaxTasks: z.coerce.number().int().min(1).max(25).optional(),
  requireApprovalGates: z.boolean().optional(),
});

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function readConfiguredWorkerToken(): string {
  const day2 = String(process.env.REVENUE_DAY2_WORKER_TOKEN || "").trim();
  if (day2) return day2;
  return String(process.env.REVENUE_DAY1_WORKER_TOKEN || "").trim();
}

function authorizeWorker(request: Request): void {
  const configured = readConfiguredWorkerToken();
  if (!configured) {
    throw new ApiError(
      503,
      "REVENUE_DAY2_WORKER_TOKEN is not configured (or fallback REVENUE_DAY1_WORKER_TOKEN)"
    );
  }
  const candidate =
    String(request.headers.get("x-revenue-day2-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== configured) {
    throw new ApiError(403, "Forbidden");
  }
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);
    const origin = request.nextUrl?.origin || new URL(request.url).origin;

    const result = await runDay2RevenueAutomation({
      uid: body.uid,
      templateIds: body.templateIds,
      origin,
      correlationId,
      log,
      dryRun: body.dryRun,
      forceRun: body.forceRun,
      dateKey: body.dateKey,
      timeZone: body.timeZone,
      autoQueueFollowups: body.autoQueueFollowups,
      followupDelayHours: body.followupDelayHours,
      followupMaxLeads: body.followupMaxLeads,
      followupSequence: body.followupSequence,
      processDueResponses: body.processDueResponses,
      responseLoopMaxTasks: body.responseLoopMaxTasks,
      requireApprovalGates: body.requireApprovalGates,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
  },
  { route: "revenue.day2.worker_task.post" }
);
