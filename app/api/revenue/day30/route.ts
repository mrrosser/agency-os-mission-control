import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseJson } from "@/lib/api/validation";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";

const bodySchema = z.object({
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

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    const origin = request.nextUrl?.origin || new URL(request.url).origin;

    const result = await runDay30RevenueAutomation({
      uid: user.uid,
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
  { route: "revenue.day30.post" }
);
