import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
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

const stageSchema = z.enum(["day1", "day2", "day30"]);

const bodySchema = z.object({
  uid: z.string().trim().min(1).max(128).optional(),
  businessKey: z.enum(["aicf", "rng", "rts"]),
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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBearerToken(request: Request): string {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function readConfiguredWorkerToken(): string {
  const day30 = asString(process.env.REVENUE_DAY30_WORKER_TOKEN);
  if (day30) return day30;
  const day2 = asString(process.env.REVENUE_DAY2_WORKER_TOKEN);
  if (day2) return day2;
  return asString(process.env.REVENUE_DAY1_WORKER_TOKEN);
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
    asString(request.headers.get("x-revenue-automation-token")) || readBearerToken(request);
  if (!candidate || candidate !== configured) {
    throw new ApiError(403, "Forbidden");
  }
}

function resolveDefaultUid(): string {
  const candidates = [
    process.env.REVENUE_AUTOMATION_UID,
    process.env.REVENUE_DAY30_UID,
    process.env.REVENUE_DAY2_UID,
    process.env.REVENUE_DAY1_UID,
    process.env.VOICE_ACTIONS_DEFAULT_UID,
    process.env.SQUARE_WEBHOOK_DEFAULT_UID,
  ];
  for (const candidate of candidates) {
    const normalized = asString(candidate);
    if (normalized) return normalized;
  }
  return "";
}

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
    authorizeWorker(request);
    const body = await parseJson(request, bodySchema);
    const uid = asString(body.uid) || resolveDefaultUid();
    if (!uid) {
      throw new ApiError(
        400,
        "Missing uid. Provide uid in request body or configure REVENUE_AUTOMATION_UID (or fallback revenue uid)."
      );
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

    if (effectiveStage === "day1") {
      const result = await runDay1RevenueAutomation({
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

      return NextResponse.json({
        ok: true,
        businessKey: body.businessKey,
        requestedStages,
        effectiveStage,
        metadata,
        result,
        correlationId,
      });
    }

    if (effectiveStage === "day2") {
      const result = await runDay2RevenueAutomation({
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
        requireApprovalGates: body.requireApprovalGates,
      });

      return NextResponse.json({
        ok: true,
        businessKey: body.businessKey,
        requestedStages,
        effectiveStage,
        metadata,
        result,
        correlationId,
      });
    }

    const result = await runDay30RevenueAutomation({
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
      requireApprovalGates: body.requireApprovalGates,
      runCloserQueue: body.runCloserQueue,
      runRevenueMemory: body.runRevenueMemory,
      runWeeklyKpi: body.runWeeklyKpi ?? !body.dueOnly,
      runServiceLab: body.runServiceLab ?? !body.dueOnly,
      serviceCandidateLimit: body.serviceCandidateLimit,
      closerQueueLookbackHours: body.closerQueueLookbackHours,
      closerQueueLimit: body.closerQueueLimit,
      memoryLookbackDays: body.memoryLookbackDays,
    });

    return NextResponse.json({
      ok: true,
      businessKey: body.businessKey,
      requestedStages,
      effectiveStage,
      metadata,
      result,
      correlationId,
    });
  },
  { route: "revenue.automation.daily.worker_task.post" }
);
