import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

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
  runWeeklyKpi: z.boolean().optional(),
  runServiceLab: z.boolean().optional(),
  runCloserQueue: z.boolean().optional(),
  runRevenueMemory: z.boolean().optional(),
  serviceCandidateLimit: z.coerce.number().int().min(1).max(10).optional(),
  closerQueueLookbackHours: z.coerce.number().int().min(1).max(24 * 14).optional(),
  closerQueueLimit: z.coerce.number().int().min(1).max(100).optional(),
  memoryLookbackDays: z.coerce.number().int().min(1).max(180).optional(),
});

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function readConfiguredWorkerToken(): string {
  const day30 = String(process.env.REVENUE_DAY30_WORKER_TOKEN || "").trim();
  if (day30) return day30;
  const day2 = String(process.env.REVENUE_DAY2_WORKER_TOKEN || "").trim();
  if (day2) return day2;
  return String(process.env.REVENUE_DAY1_WORKER_TOKEN || "").trim();
}

function authorizeWorker(request: Request): void {
  const configured = readConfiguredWorkerToken();
  if (!configured) {
    throw new ApiError(
      503,
      "REVENUE_DAY30_WORKER_TOKEN is not configured (or fallback REVENUE_DAY2_WORKER_TOKEN/REVENUE_DAY1_WORKER_TOKEN)"
    );
  }
  const candidate =
    String(request.headers.get("x-revenue-day30-token") || "").trim() || readBearerToken(request);
  if (!candidate || candidate !== configured) {
    throw new ApiError(403, "Forbidden");
  }
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);
    const origin = request.nextUrl?.origin || new URL(request.url).origin;

    const result = await runDay30RevenueAutomation({
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
      runWeeklyKpi: body.runWeeklyKpi,
      runServiceLab: body.runServiceLab,
      runCloserQueue: body.runCloserQueue,
      runRevenueMemory: body.runRevenueMemory,
      serviceCandidateLimit: body.serviceCandidateLimit,
      closerQueueLookbackHours: body.closerQueueLookbackHours,
      closerQueueLimit: body.closerQueueLimit,
      memoryLookbackDays: body.memoryLookbackDays,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
  },
  { route: "revenue.day30.worker_task.post" }
);
