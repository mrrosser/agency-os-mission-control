import "server-only";

import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { ApiError } from "@/lib/api/handler";
import { resolveSecret } from "@/lib/api/secrets";
import { getAdminDb } from "@/lib/firebase-admin";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { sourceLeads } from "@/lib/leads/sourcing";
import type { LeadSourceRequest } from "@/lib/leads/types";
import { buildLeadDocId } from "@/lib/lead-runs/ids";
import {
  LEAD_RUN_JOB_DOC_ID,
  defaultLeadRunDiagnostics,
  triggerLeadRunWorker,
  type LeadRunJobConfig,
  type LeadRunJobDoc,
} from "@/lib/lead-runs/jobs";
import {
  acquireLeadRunConcurrencySlot,
  claimLeadRunQuota,
  releaseLeadRunConcurrencySlot,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";
import { buildInitialLeadStageProgress } from "@/lib/lead-runs/stages";
import { queueFollowupDraftTasksForRun } from "@/lib/outreach/followups";
import {
  findNextPendingFollowupDueAtMs,
  getOrCreateFollowupsWorkerToken,
  triggerFollowupsWorker,
} from "@/lib/outreach/followups-jobs";
import { getFollowupsOrgSettings } from "@/lib/outreach/followups-settings";
import {
  normalizeBusinessUnit,
  resolveOfferCodeForBusinessUnit,
  workspaceKeyFromBusinessUnit,
  type BusinessUnitId,
} from "@/lib/revenue/offers";

type OutreachConfig = {
  businessKey?: "aicf" | "rng" | "rts" | "rt";
  useSMS?: boolean;
  useAvatar?: boolean;
  useOutboundCall?: boolean;
  draftFirst?: boolean;
  requireBookingConfirmation?: boolean;
};

type LeadRunTemplateDoc = {
  name?: string;
  params?: LeadSourceRequest;
  outreach?: OutreachConfig;
};

export interface Day1RevenueAutomationRequest {
  uid: string;
  templateId: string;
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
}

export interface Day1RevenueAutomationResult {
  runId: string;
  templateId: string;
  dateKey: string;
  reused: boolean;
  businessUnit: BusinessUnitId;
  offerCode: string;
  leadTotals: {
    candidateTotal: number;
    scoredTotal: number;
    filteredOut: number;
  };
  sourcesUsed: string[];
  warnings: string[];
  job: {
    status: "queued" | "skipped_no_leads";
    totalLeads: number;
    dryRun: boolean;
    draftFirst: boolean;
    requireBookingConfirmation: boolean;
    useAvatar: boolean;
    useSMS: boolean;
    useOutboundCall: boolean;
  };
  followups: {
    attempted: boolean;
    created: number;
    existing: number;
    skippedNoEmail: number;
    skippedNoOutreach: number;
    dueAtMs: number | null;
    autoEnabled: boolean;
    scheduledNextAtMs: number | null;
    dispatch: "cloud_tasks" | "http" | "skipped" | null;
    error: string | null;
  };
}

type Day1FollowupResult = Day1RevenueAutomationResult["followups"];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toUtcDateKey(value: Date = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDateKey(value: string | undefined): string {
  const normalized = String(value || "").trim();
  if (!normalized) return toUtcDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiError(400, "dateKey must be YYYY-MM-DD");
  }
  return normalized;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function buildDay1RunId(args: { uid: string; templateId: string; dateKey: string }): string {
  const digest = sha256(`${args.uid}:${args.templateId}:${args.dateKey}`).slice(0, 16);
  return `day1-${args.dateKey}-${digest}`;
}

export function buildDay1JobConfig(args: {
  businessUnit: BusinessUnitId;
  offerCode: string;
  outreach?: OutreachConfig;
  dryRun?: boolean;
  timeZone?: string;
}): LeadRunJobConfig {
  const workspaceKey = workspaceKeyFromBusinessUnit(args.businessUnit);
  const businessKey = args.outreach?.businessKey || workspaceKey;

  return {
    dryRun: Boolean(args.dryRun),
    draftFirst: args.outreach?.draftFirst ?? true,
    requireBookingConfirmation: args.outreach?.requireBookingConfirmation ?? true,
    timeZone: String(args.timeZone || "UTC").trim() || "UTC",
    businessKey,
    businessUnit: args.businessUnit,
    offerCode: args.offerCode,
    useSMS: Boolean(args.outreach?.useSMS),
    useAvatar: Boolean(args.outreach?.useAvatar),
    useOutboundCall: Boolean(args.outreach?.useOutboundCall),
  };
}

function emptyFollowupsResult(): Day1FollowupResult {
  return {
    attempted: false,
    created: 0,
    existing: 0,
    skippedNoEmail: 0,
    skippedNoOutreach: 0,
    dueAtMs: null,
    autoEnabled: false,
    scheduledNextAtMs: null,
    dispatch: null,
    error: null,
  };
}

async function queueDay1FollowupsForRun(args: {
  uid: string;
  runId: string;
  origin: string;
  correlationId: string;
  log: Logger;
  autoQueueFollowups?: boolean;
  followupDelayHours?: number;
  followupMaxLeads?: number;
  followupSequence?: number;
}): Promise<Day1FollowupResult> {
  if (!args.autoQueueFollowups) return emptyFollowupsResult();

  const result = emptyFollowupsResult();
  result.attempted = true;

  try {
    const queued = await queueFollowupDraftTasksForRun({
      runId: args.runId,
      uid: args.uid,
      delayHours: clampInt(args.followupDelayHours, 0, 24 * 30, 48),
      maxLeads: clampInt(args.followupMaxLeads, 1, 25, 25),
      sequence: clampInt(args.followupSequence, 1, 10, 1),
      log: args.log,
    });

    result.created = queued.created;
    result.existing = queued.existing;
    result.skippedNoEmail = queued.skippedNoEmail;
    result.skippedNoOutreach = queued.skippedNoOutreach;
    result.dueAtMs = queued.dueAtMs;

    const orgId = await resolveLeadRunOrgId(args.uid, args.log);
    const settings = await getFollowupsOrgSettings(orgId, args.log);
    result.autoEnabled = settings.autoEnabled;

    if (!settings.autoEnabled) {
      return result;
    }

    const followupsWorkerToken = await getOrCreateFollowupsWorkerToken({
      runId: args.runId,
      uid: args.uid,
      log: args.log,
    });
    const nextDueAtMs = await findNextPendingFollowupDueAtMs({
      runId: args.runId,
      uid: args.uid,
      lookahead: 100,
      log: args.log,
    });
    if (!nextDueAtMs) {
      return result;
    }

    const nowMs = Date.now();
    const drainDelayMs = Math.max(0, settings.drainDelaySeconds) * 1000;
    result.scheduledNextAtMs = nextDueAtMs <= nowMs ? nowMs + drainDelayMs : nextDueAtMs;
    result.dispatch = await triggerFollowupsWorker({
      origin: args.origin,
      runId: args.runId,
      workerToken: followupsWorkerToken,
      correlationId: args.correlationId,
      scheduleAtMs: result.scheduledNextAtMs,
      log: args.log,
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    args.log.warn("revenue.day1.followups_failed", {
      runId: args.runId,
      error: result.error,
    });
  }

  return result;
}

function followsSourceRequestRules(requestPayload: LeadSourceRequest): boolean {
  const hasQuery = Boolean(String(requestPayload.query || "").trim());
  const hasIndustry = Boolean(String(requestPayload.industry || "").trim());
  const usesFirestore = Array.isArray(requestPayload.sources)
    ? requestPayload.sources.includes("firestore")
    : false;
  return hasQuery || hasIndustry || usesFirestore;
}

export async function runDay1RevenueAutomation(
  args: Day1RevenueAutomationRequest
): Promise<Day1RevenueAutomationResult> {
  const dateKey = normalizeDateKey(args.dateKey);
  const dryRun = Boolean(args.dryRun);
  const autoQueueFollowups = args.autoQueueFollowups ?? true;

  const templateRef = getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("lead_run_templates")
    .doc(args.templateId);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) {
    throw new ApiError(404, "Lead template not found");
  }

  const template = (templateSnap.data() || {}) as LeadRunTemplateDoc;
  const templateParams = (template.params || {}) as LeadSourceRequest;
  if (!followsSourceRequestRules(templateParams)) {
    throw new ApiError(400, "Template requires query, industry, or firestore source");
  }

  const businessUnit = normalizeBusinessUnit(templateParams.businessUnit);
  const offerResolution = resolveOfferCodeForBusinessUnit(businessUnit, templateParams.offerCode);
  const offerCode = offerResolution.offerCode;
  if (offerResolution.adjusted && offerResolution.requestedCode) {
    args.log.warn("revenue.day1.offer_code_adjusted", {
      uid: args.uid,
      templateId: args.templateId,
      businessUnit,
      requestedOfferCode: offerResolution.requestedCode,
      appliedOfferCode: offerCode,
    });
  }
  const config = buildDay1JobConfig({
    businessUnit,
    offerCode,
    outreach: template.outreach,
    dryRun,
    timeZone: args.timeZone,
  });

  const baseRunId = buildDay1RunId({
    uid: args.uid,
    templateId: args.templateId,
    dateKey,
  });
  const baseRunRef = getAdminDb().collection("lead_runs").doc(baseRunId);
  const baseRunSnap = await baseRunRef.get();
  if (baseRunSnap.exists && !args.forceRun) {
    const baseData = baseRunSnap.data() || {};
    const candidateTotal = Number(baseData.candidateTotal || 0);
    const total = Number(baseData.total || 0);
    const followups = await queueDay1FollowupsForRun({
      uid: args.uid,
      runId: baseRunId,
      origin: args.origin,
      correlationId: args.correlationId,
      log: args.log,
      autoQueueFollowups,
      followupDelayHours: args.followupDelayHours,
      followupMaxLeads: args.followupMaxLeads,
      followupSequence: args.followupSequence,
    });

    return {
      runId: baseRunId,
      templateId: args.templateId,
      dateKey,
      reused: true,
      businessUnit,
      offerCode,
      leadTotals: {
        candidateTotal,
        scoredTotal: total,
        filteredOut: Math.max(0, candidateTotal - total),
      },
      sourcesUsed: ((baseData.sourcesUsed as string[]) || []).filter(Boolean),
      warnings: ((baseData.warnings as string[]) || []).filter(Boolean),
      job: {
        status: total > 0 ? "queued" : "skipped_no_leads",
        totalLeads: total,
        dryRun: config.dryRun,
        draftFirst: config.draftFirst,
        requireBookingConfirmation: config.requireBookingConfirmation !== false,
        useAvatar: config.useAvatar,
        useSMS: config.useSMS,
        useOutboundCall: config.useOutboundCall,
      },
      followups,
    };
  }

  const runId = baseRunSnap.exists && args.forceRun ? `${baseRunId}-${randomUUID().slice(0, 8)}` : baseRunId;
  const runRef = getAdminDb().collection("lead_runs").doc(runId);

  const requestPayload: LeadSourceRequest = {
    ...templateParams,
    businessUnit,
    offerCode,
  };

  const googlePlacesKey = await resolveSecret(args.uid, "googlePlacesKey", "GOOGLE_PLACES_API_KEY");
  const firecrawlKey = await resolveSecret(args.uid, "firecrawlKey", "FIRECRAWL_API_KEY");
  const apifyToken = process.env.APIFY_TOKEN;

  const { leads, sourcesUsed, warnings, diagnostics } = await sourceLeads(requestPayload, {
    uid: args.uid,
    googlePlacesKey,
    firecrawlKey,
    apifyToken,
    log: args.log,
  });
  const runWarnings = [...(warnings || [])];
  if (offerResolution.adjusted && offerResolution.requestedCode) {
    runWarnings.unshift(
      `offer_code '${offerResolution.requestedCode}' is not valid for business_unit '${businessUnit}'; defaulted to '${offerCode}'`
    );
  }

  const scored = leads
    .filter((lead) =>
      requestPayload.minScore ? Number(lead.score || 0) >= Number(requestPayload.minScore || 0) : true
    )
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const candidateTotal = Number(diagnostics?.rawCount || leads.length);
  const filteredOut = Math.max(0, candidateTotal - scored.length);
  const sourceDiagnostics = {
    requestedLimit: Number(requestPayload.limit || 10),
    fetchedTotal: candidateTotal,
    dedupedTotal: Number(diagnostics?.dedupedCount || leads.length),
    duplicatesRemoved: Number(diagnostics?.duplicatesRemoved || 0),
    domainClusters: Number(diagnostics?.domainClusters || 0),
    maxDomainClusterSize: Number(diagnostics?.maxDomainClusterSize || 0),
    scoredTotal: scored.length,
    filteredByScore: filteredOut,
    withEmail: scored.filter((lead) => Boolean(String(lead.email || "").trim())).length,
    withoutEmail: scored.filter((lead) => !String(lead.email || "").trim()).length,
    budget: diagnostics?.budget || {
      maxCostUsd: Number(requestPayload.budget?.maxCostUsd || 0),
      maxPages: Number(requestPayload.budget?.maxPages || 0),
      maxRuntimeSec: Number(requestPayload.budget?.maxRuntimeSec || 0),
      costUsedUsd: 0,
      pagesUsed: 0,
      runtimeSec: 0,
      stopped: false,
    },
  };

  const batch = getAdminDb().batch();
  const leadsRef = runRef.collection("leads");
  for (const lead of scored) {
    const docId = buildLeadDocId({ source: lead.source, id: lead.id });
    batch.set(
      leadsRef.doc(docId),
      stripUndefined({
        ...lead,
        userId: args.uid,
        runId,
        businessUnit,
        offerCode,
        pipelineStage: "lead_capture",
        status: "new",
        stageProgress: buildInitialLeadStageProgress({
          includeEnrichment: requestPayload.includeEnrichment ?? true,
        }),
        createdAt: FieldValue.serverTimestamp(),
      }) as Record<string, unknown>,
      { merge: true }
    );
  }

  batch.set(
    runRef,
    stripUndefined({
      userId: args.uid,
      request: requestPayload,
      businessUnit,
      offerCode,
      sourcesUsed,
      warnings: runWarnings,
      candidateTotal,
      filteredOut,
      sourceDiagnostics,
      total: scored.length,
      automation: {
        mode: "day1",
        templateId: args.templateId,
        dateKey,
      },
      createdAt: FieldValue.serverTimestamp(),
    }) as Record<string, unknown>,
    { merge: true }
  );
  await batch.commit();

  const followups = emptyFollowupsResult();

  if (scored.length === 0) {
    return {
      runId,
      templateId: args.templateId,
      dateKey,
      reused: false,
      businessUnit,
      offerCode,
      leadTotals: {
        candidateTotal,
        scoredTotal: 0,
        filteredOut,
      },
      sourcesUsed,
      warnings: runWarnings,
      job: {
        status: "skipped_no_leads",
        totalLeads: 0,
        dryRun: config.dryRun,
        draftFirst: config.draftFirst,
        requireBookingConfirmation: config.requireBookingConfirmation !== false,
        useAvatar: config.useAvatar,
        useSMS: config.useSMS,
        useOutboundCall: config.useOutboundCall,
      },
      followups,
    };
  }

  const orgId = await resolveLeadRunOrgId(args.uid, args.log);
  await claimLeadRunQuota({
    orgId,
    uid: args.uid,
    requestedLeads: scored.length,
    runId,
    correlationId: args.correlationId,
    log: args.log,
  });
  await acquireLeadRunConcurrencySlot({
    orgId,
    runId,
    correlationId: args.correlationId,
    log: args.log,
  });

  const workerToken = randomUUID();
  const job: LeadRunJobDoc = {
    runId,
    userId: args.uid,
    orgId,
    status: "queued",
    config,
    workerToken,
    leadDocIds: scored.map((lead) => buildLeadDocId({ source: lead.source, id: lead.id })),
    nextIndex: 0,
    totalLeads: scored.length,
    diagnostics: {
      ...defaultLeadRunDiagnostics(),
      sourceFetched: sourceDiagnostics.fetchedTotal,
      sourceScored: sourceDiagnostics.scoredTotal,
      sourceFilteredByScore: sourceDiagnostics.filteredByScore,
      sourceWithEmail: sourceDiagnostics.withEmail,
      sourceWithoutEmail: sourceDiagnostics.withoutEmail,
    },
    attemptsByLead: {},
    correlationId: args.correlationId,
  };

  try {
    await runRef
      .collection("jobs")
      .doc(LEAD_RUN_JOB_DOC_ID)
      .set(
        {
          ...job,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (error) {
    await releaseLeadRunConcurrencySlot({
      orgId,
      runId,
      correlationId: args.correlationId,
      log: args.log,
    });
    throw error;
  }

  void triggerLeadRunWorker(args.origin, runId, workerToken, args.correlationId, args.log);

  const seededFollowups = await queueDay1FollowupsForRun({
    uid: args.uid,
    runId,
    origin: args.origin,
    correlationId: args.correlationId,
    log: args.log,
    autoQueueFollowups,
    followupDelayHours: args.followupDelayHours,
    followupMaxLeads: args.followupMaxLeads,
    followupSequence: args.followupSequence,
  });

  return {
    runId,
    templateId: args.templateId,
    dateKey,
    reused: false,
    businessUnit,
    offerCode,
    leadTotals: {
      candidateTotal,
      scoredTotal: scored.length,
      filteredOut,
    },
    sourcesUsed,
    warnings: runWarnings,
    job: {
      status: "queued",
      totalLeads: scored.length,
      dryRun: config.dryRun,
      draftFirst: config.draftFirst,
      requireBookingConfirmation: config.requireBookingConfirmation !== false,
      useAvatar: config.useAvatar,
      useSMS: config.useSMS,
      useOutboundCall: config.useOutboundCall,
    },
    followups: seededFollowups,
  };
}
