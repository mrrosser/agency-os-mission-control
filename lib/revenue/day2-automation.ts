import "server-only";

import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import type { Logger } from "@/lib/logging";
import { processDueFollowupDraftTasks } from "@/lib/outreach/followups";
import {
  findNextPendingFollowupDueAtMs,
  getOrCreateFollowupsWorkerToken,
  triggerFollowupsWorker,
} from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";
import {
  runDay1RevenueAutomation,
  type Day1RevenueAutomationResult,
} from "@/lib/revenue/day1-automation";

type LeadRunTemplateOutreach = {
  draftFirst?: boolean;
  useSMS?: boolean;
  useOutboundCall?: boolean;
};

export interface Day2RevenueAutomationRequest {
  uid: string;
  templateIds: string[];
  origin: string;
  correlationId: string;
  log: Logger;
  dryRun?: boolean;
  forceRun?: boolean;
  dateKey?: string;
  timeZone?: string;
  autoQueueFollowups?: boolean;
  followupDelayHours?: number;
  followupMaxLeads?: number;
  followupSequence?: number;
  processDueResponses?: boolean;
  responseLoopMaxTasks?: number;
  requireApprovalGates?: boolean;
}

export interface Day2ResponseLoopResult {
  attempted: boolean;
  autoEnabled: boolean;
  maxTasks: number;
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
  scheduledNextAtMs: number | null;
  dispatch: "cloud_tasks" | "http" | "skipped" | null;
  error: string | null;
}

export interface Day2TemplateResult {
  templateId: string;
  ok: boolean;
  day1: Day1RevenueAutomationResult | null;
  responseLoop: Day2ResponseLoopResult | null;
  error: string | null;
}

export interface Day2RevenueAutomationResult {
  uid: string;
  dateKey: string | null;
  dryRun: boolean;
  processDueResponses: boolean;
  requireApprovalGates: boolean;
  templates: Day2TemplateResult[];
  totals: {
    templatesAttempted: number;
    templatesSucceeded: number;
    leadsScored: number;
    followupsSeeded: number;
    responseProcessed: number;
    responseCompleted: number;
    responseSkipped: number;
    responseFailed: number;
  };
  warnings: string[];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeDay2TemplateIds(input: readonly string[] | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input || []) {
    const templateId = String(raw || "").trim();
    if (!templateId) continue;
    if (templateId.length > 120) continue;
    if (seen.has(templateId)) continue;
    seen.add(templateId);
    out.push(templateId);
  }
  return out;
}

async function enforceApprovalGates(args: {
  uid: string;
  templateId: string;
}): Promise<void> {
  const templateRef = getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("lead_run_templates")
    .doc(args.templateId);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) {
    throw new ApiError(404, `Lead template not found: ${args.templateId}`);
  }

  const outreach = ((templateSnap.data() || {}).outreach || {}) as LeadRunTemplateOutreach;
  if (outreach.draftFirst === false) {
    throw new ApiError(
      409,
      `Template '${args.templateId}' is not approval-safe: outreach.draftFirst must be true`
    );
  }
  if (outreach.useSMS === true || outreach.useOutboundCall === true) {
    throw new ApiError(
      409,
      `Template '${args.templateId}' is not approval-safe: disable useSMS/useOutboundCall for Day2 loop`
    );
  }
}

function emptyResponseLoopResult(maxTasks: number): Day2ResponseLoopResult {
  return {
    attempted: false,
    autoEnabled: false,
    maxTasks,
    processed: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    scheduledNextAtMs: null,
    dispatch: null,
    error: null,
  };
}

async function processResponseLoopForRun(args: {
  runId: string;
  uid: string;
  origin: string;
  correlationId: string;
  dryRun: boolean;
  maxTasks: number;
  log: Logger;
}): Promise<Day2ResponseLoopResult> {
  const result = emptyResponseLoopResult(args.maxTasks);
  result.attempted = true;

  try {
    const orgId = await resolveLeadRunOrgId(args.uid, args.log);
    if (!orgId) {
      throw new ApiError(400, `Missing orgId for uid '${args.uid}'`);
    }

    const settings = await getFollowupsOrgSettings(orgId, args.log);
    result.autoEnabled = settings.autoEnabled;
    if (!settings.autoEnabled) {
      return result;
    }

    const processed = await processDueFollowupDraftTasks({
      runId: args.runId,
      orgId,
      uid: args.uid,
      maxTasks: args.maxTasks,
      dryRun: args.dryRun,
      log: args.log,
    });

    result.processed = processed.processed;
    result.completed = processed.completed;
    result.skipped = processed.skipped;
    result.failed = processed.failed;

    const nextDueAtMs = await findNextPendingFollowupDueAtMs({
      runId: args.runId,
      uid: args.uid,
      lookahead: 100,
      log: args.log,
    });
    if (!nextDueAtMs) {
      return result;
    }

    const workerToken = await getOrCreateFollowupsWorkerToken({
      runId: args.runId,
      uid: args.uid,
      log: args.log,
    });
    const nowMs = Date.now();
    const drainDelayMs = Math.max(0, settings.drainDelaySeconds) * 1000;
    const scheduleAtMs = nextDueAtMs <= nowMs ? nowMs + drainDelayMs : nextDueAtMs;
    result.scheduledNextAtMs = scheduleAtMs;
    result.dispatch = await triggerFollowupsWorker({
      origin: args.origin,
      runId: args.runId,
      workerToken,
      correlationId: args.correlationId,
      scheduleAtMs,
      log: args.log,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    args.log.warn("revenue.day2.response_loop_failed", {
      runId: args.runId,
      error: result.error,
    });
    return result;
  }
}

export async function runDay2RevenueAutomation(
  args: Day2RevenueAutomationRequest
): Promise<Day2RevenueAutomationResult> {
  const templateIds = normalizeDay2TemplateIds(args.templateIds);
  if (!templateIds.length) {
    throw new ApiError(400, "At least one templateId is required");
  }

  const dryRun = Boolean(args.dryRun);
  const processDueResponses = args.processDueResponses !== false;
  const requireApprovalGates = args.requireApprovalGates !== false;
  const responseLoopMaxTasks = clampInt(args.responseLoopMaxTasks, 1, 25, 10);

  const templates: Day2TemplateResult[] = [];
  const warnings: string[] = [];

  const totals = {
    templatesAttempted: templateIds.length,
    templatesSucceeded: 0,
    leadsScored: 0,
    followupsSeeded: 0,
    responseProcessed: 0,
    responseCompleted: 0,
    responseSkipped: 0,
    responseFailed: 0,
  };

  for (const templateId of templateIds) {
    try {
      if (requireApprovalGates) {
        await enforceApprovalGates({
          uid: args.uid,
          templateId,
        });
      }

      const day1 = await runDay1RevenueAutomation({
        uid: args.uid,
        templateId,
        origin: args.origin,
        correlationId: args.correlationId,
        log: args.log,
        dryRun,
        forceRun: args.forceRun,
        dateKey: args.dateKey,
        timeZone: args.timeZone,
        autoQueueFollowups: args.autoQueueFollowups,
        followupDelayHours: args.followupDelayHours,
        followupMaxLeads: args.followupMaxLeads,
        followupSequence: args.followupSequence,
      });

      let responseLoop: Day2ResponseLoopResult | null = null;
      if (processDueResponses) {
        responseLoop = await processResponseLoopForRun({
          runId: day1.runId,
          uid: args.uid,
          origin: args.origin,
          correlationId: args.correlationId,
          dryRun,
          maxTasks: responseLoopMaxTasks,
          log: args.log,
        });
      }

      totals.templatesSucceeded += 1;
      totals.leadsScored += Number(day1.leadTotals?.scoredTotal || 0);
      totals.followupsSeeded += Number(day1.followups?.created || 0);
      totals.responseProcessed += Number(responseLoop?.processed || 0);
      totals.responseCompleted += Number(responseLoop?.completed || 0);
      totals.responseSkipped += Number(responseLoop?.skipped || 0);
      totals.responseFailed += Number(responseLoop?.failed || 0);

      templates.push({
        templateId,
        ok: true,
        day1,
        responseLoop,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`template '${templateId}' failed: ${message}`);
      args.log.warn("revenue.day2.template_failed", { templateId, error: message });
      templates.push({
        templateId,
        ok: false,
        day1: null,
        responseLoop: null,
        error: message,
      });
    }
  }

  if (totals.templatesSucceeded === 0) {
    throw new ApiError(500, "Day2 automation failed for all templateIds");
  }

  return {
    uid: args.uid,
    dateKey: args.dateKey || null,
    dryRun,
    processDueResponses,
    requireApprovalGates,
    templates,
    totals,
    warnings,
  };
}
