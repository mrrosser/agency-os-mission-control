import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";

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
});

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const origin = request.nextUrl?.origin || new URL(request.url).origin;

    const result = await runDay2RevenueAutomation({
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
    });

    return NextResponse.json({
      ok: true,
      ...result,
      correlationId,
    });
  },
  { route: "revenue.day2.post" }
);
