import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import {
  normalizeRevenueAutomationStages,
  orderedRevenueAutomationStages,
  resolveRevenueAutomationStage,
  templateIdForRevenueBusiness,
  type RevenueAutomationBusinessKey,
  type RevenueAutomationStage,
} from "@/lib/revenue/daily-automation";
import { runDay1RevenueAutomation } from "@/lib/revenue/day1-automation";
import { runDay2RevenueAutomation } from "@/lib/revenue/day2-automation";
import { runDay30RevenueAutomation } from "@/lib/revenue/day30-automation";
import { resolveRuntimePause } from "@/lib/agents/autonomy-runtime";
import { evaluateDailyOutcomesForRevenueWorker } from "@/lib/revenue/daily-outcome-worker";
import {
  authorizeRevenueAutomationWorker,
  resolveRevenueAutomationWorkerUid,
} from "@/lib/revenue/worker-auth";

const stageSchema = z.enum(["day1", "day2", "day30"]);

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
  businessKey: z.enum(["rng", "rts"]),
  timeZone: z.string().trim().min(1).max(80).optional(),
  runStages: z.array(stageSchema).min(1).max(3).optional(),
  dueOnly: z.boolean().default(true),
  dryRun: z.boolean().optional(),
  forceRun: z.boolean().optional(),
  autoQueueFollowups: z.boolean().optional(),
  followupDelayHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
  followupMaxLeads: z.coerce.number().int().min(1).max(25).optional(),
  followupSequence: z.coerce.number().int().min(1).max(10).optional(),
  processDueResponses: z.boolean().optional(),
  responseLoopMaxTasks: z.coerce.number().int().min(1).max(25).optional(),
  requireApprovalGates: z.boolean().optional(),
  runCloserQueue: z.boolean().optional(),
  runRevenueMemory: z.boolean().optional(),
  runWeeklyKpi: z.boolean().optional(),
  runServiceLab: z.boolean().optional(),
  serviceCandidateLimit: z.coerce.number().int().min(1).max(10).optional(),
  closerQueueLookbackHours: z.coerce.number().int().min(1).max(24 * 14).optional(),
  closerQueueLimit: z.coerce.number().int().min(1).max(100).optional(),
  memoryLookbackDays: z.coerce.number().int().min(1).max(180).optional(),
});

function metadataForRun(args: {
  businessKey: RevenueAutomationBusinessKey;
  dryRun: boolean;
  correlationId: string;
}) {
  return {
    run_id: randomUUID(),
    job_name: `revenue-automation-${args.businessKey}`,
    surface: "cloud_scheduler",
    repo: "agency-os-mission-control",
    mode: args.dryRun ? "dry_run" : "live",
    correlation_id: args.correlationId,
  } as const;
}

function normalizedRequestedStages(
  input: readonly RevenueAutomationStage[] | undefined,
  dueOnly: boolean
): RevenueAutomationStage[] {
  const normalized = normalizeRevenueAutomationStages(input);
  if (normalized.length > 0) return normalized;
  return dueOnly ? ["day30"] : orderedRevenueAutomationStages();
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const auth = await authorizeRevenueAutomationWorker({ request, correlationId, log });
    const body = await parseJson(request, bodySchema);
    const uid = resolveRevenueAutomationWorkerUid(body.uid);

    const pause = await resolveRuntimePause({
      uid,
      businessKey: body.businessKey,
      log,
    });
    if (pause.paused) {
      log.warn("revenue.automation.autonomy_paused", {
        uid,
        businessKey: body.businessKey,
        businessId: pause.businessId,
        reason: pause.reason,
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: pause.reason,
        businessKey: body.businessKey,
        correlationId,
      });
    }

    const origin = request.nextUrl?.origin || new URL(request.url).origin;
    const requestedStages = normalizedRequestedStages(body.runStages, body.dueOnly);
    const effectiveStage = resolveRevenueAutomationStage(requestedStages);
    const templateId = templateIdForRevenueBusiness(body.businessKey);
    const metadata = metadataForRun({
      businessKey: body.businessKey,
      dryRun: Boolean(body.dryRun),
      correlationId,
    });

    let result: unknown;
    if (effectiveStage === "day1") {
      result = await runDay1RevenueAutomation({
        uid,
        templateId,
        origin,
        correlationId,
        log,
        dryRun: body.dryRun,
        forceRun: body.forceRun,
        timeZone: body.timeZone,
        autoQueueFollowups: body.autoQueueFollowups,
        followupDelayHours: body.followupDelayHours,
        followupMaxLeads: body.followupMaxLeads,
        followupSequence: body.followupSequence,
      });
    } else if (effectiveStage === "day2") {
      result = await runDay2RevenueAutomation({
        uid,
        templateIds: [templateId],
        origin,
        correlationId,
        log,
        dryRun: body.dryRun,
        forceRun: body.forceRun,
        timeZone: body.timeZone,
        autoQueueFollowups: body.autoQueueFollowups,
        followupDelayHours: body.followupDelayHours,
        followupMaxLeads: body.followupMaxLeads,
        followupSequence: body.followupSequence,
        processDueResponses: body.processDueResponses,
        responseLoopMaxTasks: body.responseLoopMaxTasks,
        requireApprovalGates: true,
      });
    } else {
      result = await runDay30RevenueAutomation({
        uid,
        templateIds: [templateId],
        origin,
        correlationId,
        log,
        dryRun: body.dryRun,
        forceRun: body.forceRun,
        timeZone: body.timeZone,
        autoQueueFollowups: body.autoQueueFollowups,
        followupDelayHours: body.followupDelayHours,
        followupMaxLeads: body.followupMaxLeads,
        followupSequence: body.followupSequence,
        processDueResponses: body.processDueResponses,
        responseLoopMaxTasks: body.responseLoopMaxTasks,
        requireApprovalGates: true,
        runCloserQueue: body.runCloserQueue,
        runRevenueMemory: body.runRevenueMemory,
        runWeeklyKpi: body.runWeeklyKpi ?? !body.dueOnly,
        runServiceLab: body.runServiceLab ?? !body.dueOnly,
        serviceCandidateLimit: body.serviceCandidateLimit,
        closerQueueLookbackHours: body.closerQueueLookbackHours,
        closerQueueLimit: body.closerQueueLimit,
        memoryLookbackDays: body.memoryLookbackDays,
      });
    }

    log.info("revenue.automation.daily.completed", {
      correlationId,
      businessKey: body.businessKey,
      effectiveStage,
      authMode: auth.mode,
    });
    const dailyOutcomeDashboard = await evaluateDailyOutcomesForRevenueWorker({
      uid,
      correlationId,
      log,
    });

    return NextResponse.json({
      ok: true,
      businessKey: body.businessKey,
      requestedStages,
      effectiveStage,
      metadata,
      result,
      dailyOutcomeDashboard,
      correlationId,
    });
  },
  { route: "revenue.automation.daily.worker_task.post" }
);
