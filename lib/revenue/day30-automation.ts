import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { runDay2RevenueAutomation, normalizeDay2TemplateIds, type Day2RevenueAutomationResult } from "@/lib/revenue/day2-automation";
import {
  runWeeklyKpiRollup,
  type WeeklyKpiDecision,
  type WeeklyKpiDecisionSummary,
  type WeeklyKpiReport,
  type WeeklyKpiSegment,
} from "@/lib/revenue/weekly-kpi";
import { getPosWorkerStatus, type PosWorkerStatusSnapshot } from "@/lib/revenue/pos-worker";
import {
  normalizeBusinessUnit,
  normalizeCrmPipelineStage,
  normalizeOfferCode,
  type BusinessUnitId,
  type CrmPipelineStage,
} from "@/lib/revenue/offers";

const DEFAULT_TIME_ZONE = "America/Chicago";
const MAX_LEAD_SCAN = 5000;

type DecisionAction = WeeklyKpiDecision["action"];

export interface RevenueLeadSignal {
  leadId: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  pipelineStage: CrmPipelineStage;
  valueUsd: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  winReason: string | null;
  lossReason: string | null;
  objectionReason: string | null;
}

export interface RevenueReasonCount {
  reason: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  count: number;
}

export interface RevenueMemorySummary {
  weekStartDate: string;
  lookbackDays: number;
  scannedLeads: number;
  consideredLeads: number;
  wonCount: number;
  lostCount: number;
  openCount: number;
  winReasons: RevenueReasonCount[];
  lossReasons: RevenueReasonCount[];
  objectionReasons: RevenueReasonCount[];
}

export interface HotCloserQueueEntry {
  queueId: string;
  leadId: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  pipelineStage: CrmPipelineStage;
  priority: "high" | "medium";
  signal: "proposal_signal" | "booking_signal";
  valueUsd: number;
  updatedAt: string | null;
  slaTargetAtMs: number;
  breached: boolean;
}

export interface CloserQueueSummary {
  scannedLeads: number;
  queueSize: number;
  breachedCount: number;
  highPriorityCount: number;
  generatedAt: string;
}

export interface ServiceLabCandidate {
  candidateId: string;
  weekStartDate: string;
  title: string;
  targetBusiness: BusinessUnitId;
  offerCode: string;
  action: DecisionAction;
  problemEvidence: string;
  offerHypothesis: string;
  priceBandHypothesis: string;
  testDesign: string;
  status: "draft";
  sourceDecisionId: string | null;
}

export interface DailyExecutiveDigest {
  dateKey: string;
  timeZone: string;
  summary: {
    templatesSucceeded: number;
    leadsScored: number;
    followupsSeeded: number;
    responseCompleted: number;
    responseFailed: number;
    closeRatePct: number;
    dealsWon: number;
    pendingApprovals: number;
    closerQueueOpen: number;
    closerQueueBreached: number;
  };
  blockers: string[];
  topPriorities: string[];
}

export interface Day30RevenueAutomationRequest {
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
  runWeeklyKpi?: boolean;
  runServiceLab?: boolean;
  runCloserQueue?: boolean;
  runRevenueMemory?: boolean;
  serviceCandidateLimit?: number;
  closerQueueLookbackHours?: number;
  closerQueueLimit?: number;
  memoryLookbackDays?: number;
}

export interface Day30RevenueAutomationResult {
  uid: string;
  dateKey: string;
  timeZone: string;
  cadence: {
    runWeeklyKpi: boolean;
    runServiceLab: boolean;
    runCloserQueue: boolean;
    runRevenueMemory: boolean;
  };
  day2: Day2RevenueAutomationResult;
  weeklyKpi: {
    weekStartDate: string | null;
    closeRatePct: number | null;
    dealsWon: number | null;
    decisionSummary: WeeklyKpiDecisionSummary | null;
  } | null;
  revenueMemory: RevenueMemorySummary | null;
  closerQueue: CloserQueueSummary | null;
  serviceLab: {
    generated: number;
    candidateIds: string[];
  } | null;
  dailyDigest: DailyExecutiveDigest;
  warnings: string[];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeDateKey(value: string | undefined): string {
  const normalized = asString(value || "");
  if (!normalized) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiError(400, "dateKey must be YYYY-MM-DD");
  }
  return normalized;
}

function shiftDateKey(dateKey: string, days: number): string {
  const baseline = new Date(`${dateKey}T00:00:00.000Z`);
  baseline.setUTCDate(baseline.getUTCDate() + days);
  return baseline.toISOString().slice(0, 10);
}

function weekStartFromDateKey(dateKey: string): string {
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftDateKey(dateKey, -daysSinceMonday);
}

function normalizeTimeZone(value: string | undefined): string {
  const candidate = asString(value || "");
  if (!candidate) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function isMondayDateKey(dateKey: string): boolean {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() === 1;
}

function normalizeReason(value: string | null): string {
  const trimmed = asString(value || "");
  if (!trimmed) return "unspecified";
  return trimmed.slice(0, 120);
}

function reasonBuckets(items: RevenueReasonCount[]): RevenueReasonCount[] {
  return [...items].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.businessUnit !== b.businessUnit) return a.businessUnit.localeCompare(b.businessUnit);
    if (a.offerCode !== b.offerCode) return a.offerCode.localeCompare(b.offerCode);
    return a.reason.localeCompare(b.reason);
  });
}

function decisionSummaryOrDefault(value: unknown): WeeklyKpiDecisionSummary {
  const row = (value || {}) as Record<string, unknown>;
  return {
    scale: Math.max(0, safeNumber(row.scale)),
    fix: Math.max(0, safeNumber(row.fix)),
    kill: Math.max(0, safeNumber(row.kill)),
    watch: Math.max(0, safeNumber(row.watch)),
  };
}

function parseWeeklySegment(raw: unknown): WeeklyKpiSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const businessUnit = normalizeBusinessUnit(row.businessUnit);
  const offerCode = normalizeOfferCode(row.offerCode);
  if (!offerCode) return null;
  return {
    businessUnit,
    offerCode,
    leadsSourced: Math.max(0, safeNumber(row.leadsSourced)),
    qualifiedLeads: Math.max(0, safeNumber(row.qualifiedLeads)),
    outreachReady: Math.max(0, safeNumber(row.outreachReady)),
    meetingsBooked: Math.max(0, safeNumber(row.meetingsBooked)),
    depositsCollected: Math.max(0, safeNumber(row.depositsCollected)),
    dealsWon: Math.max(0, safeNumber(row.dealsWon)),
    closeRatePct: Math.max(0, safeNumber(row.closeRatePct)),
    avgCycleDaysToDeposit:
      row.avgCycleDaysToDeposit === null || row.avgCycleDaysToDeposit === undefined
        ? null
        : safeNumber(row.avgCycleDaysToDeposit),
    pipelineValueUsd: Math.max(0, safeNumber(row.pipelineValueUsd)),
  };
}

function parseWeeklyDecision(raw: unknown): WeeklyKpiDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const businessUnit = normalizeBusinessUnit(row.businessUnit);
  const offerCode = normalizeOfferCode(row.offerCode);
  const actionRaw = asString(row.action).toLowerCase();
  const action: DecisionAction =
    actionRaw === "scale" || actionRaw === "fix" || actionRaw === "kill" || actionRaw === "watch"
      ? actionRaw
      : "watch";
  if (!offerCode) return null;

  return {
    decisionId: asString(row.decisionId) || `${businessUnit}:${offerCode}:${action}`,
    weekStartDate: asString(row.weekStartDate) || "",
    businessUnit,
    offerCode,
    action,
    reason: asString(row.reason) || "No reason captured",
    streakWeeks: Math.max(0, safeNumber(row.streakWeeks)),
    leadsSourced: Math.max(0, safeNumber(row.leadsSourced)),
    closeRatePct: Math.max(0, safeNumber(row.closeRatePct)),
    meetingRatePct: Math.max(0, safeNumber(row.meetingRatePct)),
    depositRateFromMeetingsPct: Math.max(0, safeNumber(row.depositRateFromMeetingsPct)),
    cycleDaysToDeposit:
      row.cycleDaysToDeposit === null || row.cycleDaysToDeposit === undefined
        ? null
        : safeNumber(row.cycleDaysToDeposit),
  };
}

function parseWeeklyReport(raw: unknown): WeeklyKpiReport | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const weekStartDate = asString(row.weekStartDate);
  const weekEndDate = asString(row.weekEndDate);
  if (!weekStartDate || !weekEndDate) return null;

  const summaryRow = (row.summary || {}) as Record<string, unknown>;
  const segmentsRaw = Array.isArray(row.segments) ? row.segments : [];
  const decisionsRaw = Array.isArray(row.decisions) ? row.decisions : [];

  const segments = segmentsRaw
    .map((segment) => parseWeeklySegment(segment))
    .filter((segment): segment is WeeklyKpiSegment => Boolean(segment));
  const decisions = decisionsRaw
    .map((decision) => parseWeeklyDecision(decision))
    .filter((decision): decision is WeeklyKpiDecision => Boolean(decision));

  return {
    uid: asString(row.uid),
    timeZone: asString(row.timeZone) || DEFAULT_TIME_ZONE,
    weekStartDate,
    weekEndDate,
    scannedLeadCount: Math.max(0, safeNumber(row.scannedLeadCount)),
    sampled: Boolean(row.sampled),
    summary: {
      leadsSourced: Math.max(0, safeNumber(summaryRow.leadsSourced)),
      qualifiedLeads: Math.max(0, safeNumber(summaryRow.qualifiedLeads)),
      outreachReady: Math.max(0, safeNumber(summaryRow.outreachReady)),
      meetingsBooked: Math.max(0, safeNumber(summaryRow.meetingsBooked)),
      depositsCollected: Math.max(0, safeNumber(summaryRow.depositsCollected)),
      dealsWon: Math.max(0, safeNumber(summaryRow.dealsWon)),
      closeRatePct: Math.max(0, safeNumber(summaryRow.closeRatePct)),
      avgCycleDaysToDeposit:
        summaryRow.avgCycleDaysToDeposit === null || summaryRow.avgCycleDaysToDeposit === undefined
          ? null
          : safeNumber(summaryRow.avgCycleDaysToDeposit),
      pipelineValueUsd: Math.max(0, safeNumber(summaryRow.pipelineValueUsd)),
    },
    segments,
    decisions,
    decisionSummary: decisionSummaryOrDefault(row.decisionSummary),
  };
}

export function summarizeRevenueMemoryFromSignals(args: {
  leads: RevenueLeadSignal[];
  weekStartDate: string;
  lookbackDays?: number;
  nowMs?: number;
}): RevenueMemorySummary {
  const lookbackDays = clampInt(args.lookbackDays, 1, 180, 30);
  const nowMs = Number.isFinite(args.nowMs || Number.NaN) ? Number(args.nowMs) : Date.now();
  const cutoffMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

  const winMap = new Map<string, RevenueReasonCount>();
  const lossMap = new Map<string, RevenueReasonCount>();
  const objectionMap = new Map<string, RevenueReasonCount>();

  let consideredLeads = 0;
  let wonCount = 0;
  let lostCount = 0;
  let openCount = 0;

  const bump = (
    map: Map<string, RevenueReasonCount>,
    businessUnit: BusinessUnitId,
    offerCode: string,
    reason: string
  ) => {
    const normalizedReason = normalizeReason(reason);
    const key = `${businessUnit}:${offerCode}:${normalizedReason.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    map.set(key, {
      reason: normalizedReason,
      businessUnit,
      offerCode,
      count: 1,
    });
  };

  for (const lead of args.leads) {
    const activityMs = lead.updatedAt?.getTime() || lead.createdAt?.getTime() || Number.NaN;
    if (!Number.isFinite(activityMs) || activityMs < cutoffMs) continue;

    consideredLeads += 1;
    if (lead.pipelineStage === "won" || lead.pipelineStage === "deposit_received") {
      wonCount += 1;
      bump(winMap, lead.businessUnit, lead.offerCode, lead.winReason || "unspecified");
    } else if (lead.pipelineStage === "lost") {
      lostCount += 1;
      bump(lossMap, lead.businessUnit, lead.offerCode, lead.lossReason || "unspecified");
    } else {
      openCount += 1;
    }

    if (lead.objectionReason) {
      bump(objectionMap, lead.businessUnit, lead.offerCode, lead.objectionReason);
    }
  }

  return {
    weekStartDate: args.weekStartDate,
    lookbackDays,
    scannedLeads: args.leads.length,
    consideredLeads,
    wonCount,
    lostCount,
    openCount,
    winReasons: reasonBuckets(Array.from(winMap.values())),
    lossReasons: reasonBuckets(Array.from(lossMap.values())),
    objectionReasons: reasonBuckets(Array.from(objectionMap.values())),
  };
}

function queueDocId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || sha(value).slice(0, 16);
}

export function buildHotCloserQueueEntries(args: {
  leads: RevenueLeadSignal[];
  lookbackHours?: number;
  limit?: number;
  nowMs?: number;
  slaMinutes?: number;
}): HotCloserQueueEntry[] {
  const lookbackHours = clampInt(args.lookbackHours, 1, 24 * 14, 72);
  const limit = clampInt(args.limit, 1, 100, 40);
  const nowMs = Number.isFinite(args.nowMs || Number.NaN) ? Number(args.nowMs) : Date.now();
  const slaMinutes = clampInt(args.slaMinutes, 5, 180, 30);
  const cutoffMs = nowMs - lookbackHours * 60 * 60 * 1000;
  const slaMs = slaMinutes * 60 * 1000;

  const candidates = args.leads
    .filter((lead) => lead.pipelineStage === "booking" || lead.pipelineStage === "proposal")
    .filter((lead) => {
      const updatedMs = lead.updatedAt?.getTime() || Number.NaN;
      return Number.isFinite(updatedMs) && updatedMs >= cutoffMs;
    })
    .sort((a, b) => {
      const stageWeight = (stage: CrmPipelineStage): number => (stage === "proposal" ? 2 : 1);
      const stageDelta = stageWeight(b.pipelineStage) - stageWeight(a.pipelineStage);
      if (stageDelta !== 0) return stageDelta;
      if (b.valueUsd !== a.valueUsd) return b.valueUsd - a.valueUsd;
      return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
    })
    .slice(0, limit);

  return candidates.map((lead) => {
    const updatedMs = lead.updatedAt?.getTime() || nowMs;
    const signal = lead.pipelineStage === "proposal" ? "proposal_signal" : "booking_signal";
    const priority = lead.pipelineStage === "proposal" || lead.valueUsd >= 3000 ? "high" : "medium";
    const slaTargetAtMs = updatedMs + slaMs;
    return {
      queueId: queueDocId(`closer_${lead.leadId}`),
      leadId: lead.leadId,
      businessUnit: lead.businessUnit,
      offerCode: lead.offerCode,
      pipelineStage: lead.pipelineStage,
      priority,
      signal,
      valueUsd: round2(lead.valueUsd),
      updatedAt: lead.updatedAt ? lead.updatedAt.toISOString() : null,
      slaTargetAtMs,
      breached: nowMs > slaTargetAtMs,
    };
  });
}

function businessPriceBandHint(businessUnit: BusinessUnitId, action: DecisionAction): string {
  if (businessUnit === "rt_solutions") {
    if (action === "kill") return "$750-$2,500 starter package";
    if (action === "fix") return "$1,500-$5,000 with clearer scope tiers";
    return "$2,000-$7,500 with expansion add-ons";
  }
  if (businessUnit === "rosser_nft_gallery") {
    if (action === "kill") return "$150-$750 mini-offer pilot";
    if (action === "fix") return "$250-$2,500 split between starter and premium tiers";
    return "$500-$4,000 with event + preservation bundles";
  }
  if (action === "kill") return "$500-$1,500 discovery-first package";
  if (action === "fix") return "$1,500-$6,000 scoped implementation tiers";
  return "$3,000-$12,000 implementation + advisory mix";
}

export function buildServiceLabCandidates(args: {
  weekStartDate: string;
  decisions: WeeklyKpiDecision[];
  memory: RevenueMemorySummary | null;
  maxCandidates?: number;
}): ServiceLabCandidate[] {
  const maxCandidates = clampInt(args.maxCandidates, 1, 10, 5);
  const rows: ServiceLabCandidate[] = [];

  const actionable = args.decisions.filter((decision) => decision.action !== "watch");
  for (const decision of actionable) {
    const titleByAction: Record<DecisionAction, string> = {
      scale: `Scale ${decision.offerCode} into a new South-market segment`,
      fix: `Repair conversion blockers for ${decision.offerCode}`,
      kill: `Replace ${decision.offerCode} with a leaner starter service`,
      watch: `Observe ${decision.offerCode} for one more cycle`,
    };

    const offerHypothesisByAction: Record<DecisionAction, string> = {
      scale:
        "Clone the current winning offer, keep proof-heavy messaging, and add one stronger CTA variant (book vs checkout).",
      fix:
        "Introduce objection-specific proof snippets (price, timing, trust, technical) and tighten qualification copy.",
      kill:
        "Retire the weakest variant and launch a lower-friction offer focused on fast value in <= 14 days.",
      watch: "Maintain current offer while gathering additional evidence.",
    };

    const testDesignByAction: Record<DecisionAction, string> = {
      scale:
        "Run 7-day geo split test (current market vs expansion market), 50/50 lead allocation, compare close rate and cycle time.",
      fix:
        "Run 7-day objection-variant test (control vs new objection playbook), monitor reply quality + booking rate.",
      kill:
        "Run 7-day replacement test against current low-performer, stop if replacement underperforms by >20%.",
      watch: "Collect one more week of baseline data and re-score.",
    };

    const candidateId = sha(`${args.weekStartDate}:${decision.decisionId}:${decision.action}`).slice(0, 24);
    rows.push({
      candidateId,
      weekStartDate: args.weekStartDate,
      title: titleByAction[decision.action],
      targetBusiness: decision.businessUnit,
      offerCode: decision.offerCode,
      action: decision.action,
      problemEvidence: `${decision.reason} (close=${decision.closeRatePct}%, meetings=${decision.meetingRatePct}%, leads=${decision.leadsSourced})`,
      offerHypothesis: offerHypothesisByAction[decision.action],
      priceBandHypothesis: businessPriceBandHint(decision.businessUnit, decision.action),
      testDesign: testDesignByAction[decision.action],
      status: "draft",
      sourceDecisionId: decision.decisionId,
    });
  }

  if (!rows.length && args.memory) {
    const topLoss = args.memory.lossReasons[0];
    if (topLoss) {
      rows.push({
        candidateId: sha(`${args.weekStartDate}:fallback:${topLoss.businessUnit}:${topLoss.offerCode}`).slice(0, 24),
        weekStartDate: args.weekStartDate,
        title: `Address dominant loss reason for ${topLoss.offerCode}`,
        targetBusiness: topLoss.businessUnit,
        offerCode: topLoss.offerCode,
        action: "fix",
        problemEvidence: `Top loss reason over ${args.memory.lookbackDays} days: "${topLoss.reason}" (${topLoss.count} leads).`,
        offerHypothesis:
          "Build a narrow, proof-first variant that explicitly resolves the top recurring objection before asking for booking.",
        priceBandHypothesis: businessPriceBandHint(topLoss.businessUnit, "fix"),
        testDesign:
          "Run a 7-day control vs variant message test, then compare booking conversion and response quality.",
        status: "draft",
        sourceDecisionId: null,
      });
    }
  }

  return rows.slice(0, maxCandidates);
}

export function buildDailyExecutiveDigest(args: {
  dateKey: string;
  timeZone: string;
  day2: Day2RevenueAutomationResult;
  weeklyKpi: WeeklyKpiReport | null;
  closerQueue: CloserQueueSummary | null;
  posStatus: PosWorkerStatusSnapshot | null;
}): DailyExecutiveDigest {
  const blockers: string[] = [];
  const topPriorities: string[] = [];

  if (args.day2.totals.responseFailed > 0) {
    blockers.push(`${args.day2.totals.responseFailed} response-loop tasks failed and need retry/triage.`);
  }
  if ((args.closerQueue?.breachedCount || 0) > 0) {
    blockers.push(`${args.closerQueue?.breachedCount || 0} closer queue items breached the 30-minute SLA.`);
  }
  const blockedPosEvents = args.posStatus?.summary.blockedEvents || 0;
  const deadPosEvents = args.posStatus?.summary.deadLetterEvents || 0;
  if (blockedPosEvents > 0 || deadPosEvents > 0) {
    blockers.push(`POS worker has ${blockedPosEvents} blocked and ${deadPosEvents} dead-letter events.`);
  }
  if ((args.weeklyKpi?.decisionSummary.kill || 0) > 0) {
    blockers.push(`${args.weeklyKpi?.decisionSummary.kill || 0} offer segments are in kill state.`);
  }

  if ((args.closerQueue?.highPriorityCount || 0) > 0) {
    topPriorities.push(`Handle ${args.closerQueue?.highPriorityCount || 0} high-priority closer queue items.`);
  }
  if ((args.weeklyKpi?.decisionSummary.scale || 0) > 0) {
    topPriorities.push(`Expand ${args.weeklyKpi?.decisionSummary.scale || 0} winning segment(s) into new markets.`);
  }
  if ((args.weeklyKpi?.decisionSummary.fix || 0) > 0) {
    topPriorities.push(`Patch conversion blockers for ${args.weeklyKpi?.decisionSummary.fix || 0} segment(s).`);
  }
  if (args.day2.totals.followupsSeeded > 0) {
    topPriorities.push(`Review ${args.day2.totals.followupsSeeded} newly-seeded follow-up drafts.`);
  }

  return {
    dateKey: args.dateKey,
    timeZone: args.timeZone,
    summary: {
      templatesSucceeded: args.day2.totals.templatesSucceeded,
      leadsScored: args.day2.totals.leadsScored,
      followupsSeeded: args.day2.totals.followupsSeeded,
      responseCompleted: args.day2.totals.responseCompleted,
      responseFailed: args.day2.totals.responseFailed,
      closeRatePct: args.weeklyKpi?.summary.closeRatePct ?? 0,
      dealsWon: args.weeklyKpi?.summary.dealsWon ?? 0,
      pendingApprovals: blockedPosEvents,
      closerQueueOpen: args.closerQueue?.queueSize ?? 0,
      closerQueueBreached: args.closerQueue?.breachedCount ?? 0,
    },
    blockers,
    topPriorities,
  };
}

function readReason(row: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = asString(row[field]);
    if (value) return value;
  }
  return null;
}

function leadSignalsFromDocs(docs: Array<{ id: string; data: Record<string, unknown> }>): RevenueLeadSignal[] {
  return docs.map((doc) => {
    const data = doc.data;
    const businessUnit = normalizeBusinessUnit(data.businessUnit);
    const offerCode = normalizeOfferCode(data.offerCode) || "UNSPECIFIED";
    return {
      leadId: doc.id,
      businessUnit,
      offerCode,
      pipelineStage: normalizeCrmPipelineStage(data.pipelineStage || data.status),
      valueUsd: Math.max(0, safeNumber(data.value)),
      createdAt: asDate(data.createdAt),
      updatedAt: asDate(data.updatedAt),
      winReason: readReason(data, ["winReason", "closeReason", "outcomeReason", "decisionReason"]),
      lossReason: readReason(data, ["lossReason", "outcomeReason", "reason", "followupDisposition"]),
      objectionReason: readReason(data, ["objectionBucket", "responseDisposition", "followupDisposition"]),
    };
  });
}

async function loadLeadSignals(uid: string, log: Logger): Promise<RevenueLeadSignal[]> {
  const snap = await getAdminDb().collection("leads").where("userId", "==", uid).limit(MAX_LEAD_SCAN).get();
  const docs = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: (docSnap.data() || {}) as Record<string, unknown>,
  }));
  const signals = leadSignalsFromDocs(docs);
  log.info("revenue.day30.leads.loaded", {
    uid,
    scanned: signals.length,
    sampled: signals.length >= MAX_LEAD_SCAN,
  });
  return signals;
}

async function loadLatestWeeklyKpiReport(uid: string): Promise<WeeklyKpiReport | null> {
  const snap = await getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("revenue_kpi_reports")
    .doc("latest")
    .get();
  if (!snap.exists) return null;
  return parseWeeklyReport(snap.data() || null);
}

async function persistRevenueMemory(uid: string, summary: RevenueMemorySummary): Promise<void> {
  const root = getAdminDb().collection("identities").doc(uid).collection("revenue_memory");
  const payload = {
    ...summary,
    generatedAt: FieldValue.serverTimestamp(),
    source: "day30_loop_v1",
  };
  await root.doc(summary.weekStartDate).set(payload, { merge: true });
  await root.doc("latest").set(payload, { merge: true });
}

async function persistCloserQueue(args: {
  uid: string;
  dateKey: string;
  entries: HotCloserQueueEntry[];
  summary: CloserQueueSummary;
}): Promise<void> {
  const queueRoot = getAdminDb().collection("identities").doc(args.uid).collection("closer_queue");
  const batch = getAdminDb().batch();
  const generatedAt = FieldValue.serverTimestamp();
  for (const entry of args.entries) {
    batch.set(
      queueRoot.doc(entry.queueId),
      {
        ...entry,
        status: entry.breached ? "breached" : "open",
        updatedAtServer: generatedAt,
        source: "day30_loop_v1",
        dateKey: args.dateKey,
      },
      { merge: true }
    );
  }
  await batch.commit();

  await getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("closer_queue_state")
    .doc("latest")
    .set(
      {
        ...args.summary,
        dateKey: args.dateKey,
        generatedAt,
        source: "day30_loop_v1",
      },
      { merge: true }
    );
}

async function persistServiceLabCandidates(args: {
  uid: string;
  dateKey: string;
  candidates: ServiceLabCandidate[];
}): Promise<void> {
  if (!args.candidates.length) return;
  const root = getAdminDb().collection("identities").doc(args.uid).collection("service_lab_candidates");
  const batch = getAdminDb().batch();
  for (const candidate of args.candidates) {
    batch.set(
      root.doc(candidate.candidateId),
      {
        ...candidate,
        createdAt: FieldValue.serverTimestamp(),
        dateKey: args.dateKey,
        source: "day30_loop_v1",
      },
      { merge: true }
    );
  }
  await batch.commit();
}

async function persistDailyDigest(args: {
  uid: string;
  digest: DailyExecutiveDigest;
}): Promise<void> {
  const entries = getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("executive_brain")
    .doc("daily")
    .collection("entries");
  const payload = {
    ...args.digest,
    generatedAt: FieldValue.serverTimestamp(),
    source: "day30_loop_v1",
  };
  await entries.doc(args.digest.dateKey).set(payload, { merge: true });
  await entries.doc("latest").set(payload, { merge: true });
}

export async function runDay30RevenueAutomation(
  args: Day30RevenueAutomationRequest
): Promise<Day30RevenueAutomationResult> {
  const templateIds = normalizeDay2TemplateIds(args.templateIds);
  if (!templateIds.length) {
    throw new ApiError(400, "At least one templateId is required");
  }

  const dateKey = normalizeDateKey(args.dateKey);
  const weekStartDate = weekStartFromDateKey(dateKey);
  const timeZone = normalizeTimeZone(args.timeZone);
  const runWeeklyKpi = args.runWeeklyKpi ?? isMondayDateKey(dateKey);
  const runServiceLab = args.runServiceLab ?? runWeeklyKpi;
  const runCloserQueue = args.runCloserQueue !== false;
  const runRevenueMemory = args.runRevenueMemory !== false;
  const warnings: string[] = [];

  args.log.info("revenue.day30.start", {
    uid: args.uid,
    dateKey,
    runWeeklyKpi,
    runServiceLab,
    runCloserQueue,
    runRevenueMemory,
    templateCount: templateIds.length,
  });

  const day2 = await runDay2RevenueAutomation({
    uid: args.uid,
    templateIds,
    origin: args.origin,
    correlationId: args.correlationId,
    log: args.log,
    dryRun: args.dryRun,
    forceRun: args.forceRun,
    dateKey,
    timeZone,
    autoQueueFollowups: args.autoQueueFollowups,
    followupDelayHours: args.followupDelayHours,
    followupMaxLeads: args.followupMaxLeads,
    followupSequence: args.followupSequence,
    processDueResponses: args.processDueResponses,
    responseLoopMaxTasks: args.responseLoopMaxTasks,
    requireApprovalGates: args.requireApprovalGates,
  });

  let weeklyKpi: WeeklyKpiReport | null = null;
  if (runWeeklyKpi) {
    weeklyKpi = await runWeeklyKpiRollup({
      uid: args.uid,
      timeZone,
      weekStartDate,
      log: args.log,
    });
  } else {
    weeklyKpi = await loadLatestWeeklyKpiReport(args.uid);
  }

  const leads = await loadLeadSignals(args.uid, args.log);

  let revenueMemory: RevenueMemorySummary | null = null;
  if (runRevenueMemory) {
    revenueMemory = summarizeRevenueMemoryFromSignals({
      leads,
      weekStartDate,
      lookbackDays: clampInt(args.memoryLookbackDays, 1, 180, 30),
    });
    await persistRevenueMemory(args.uid, revenueMemory);
  }

  let closerQueue: CloserQueueSummary | null = null;
  if (runCloserQueue) {
    const entries = buildHotCloserQueueEntries({
      leads,
      lookbackHours: clampInt(args.closerQueueLookbackHours, 1, 24 * 14, 72),
      limit: clampInt(args.closerQueueLimit, 1, 100, 40),
      slaMinutes: 30,
    });

    closerQueue = {
      scannedLeads: leads.length,
      queueSize: entries.length,
      breachedCount: entries.filter((entry) => entry.breached).length,
      highPriorityCount: entries.filter((entry) => entry.priority === "high").length,
      generatedAt: new Date().toISOString(),
    };
    await persistCloserQueue({
      uid: args.uid,
      dateKey,
      entries,
      summary: closerQueue,
    });
  }

  let posStatus: PosWorkerStatusSnapshot | null = null;
  try {
    posStatus = await getPosWorkerStatus({ uid: args.uid, log: args.log });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`pos_status_unavailable: ${message}`);
    args.log.warn("revenue.day30.pos_status_unavailable", {
      uid: args.uid,
      error: message,
    });
  }

  let serviceLabCandidates: ServiceLabCandidate[] = [];
  if (runServiceLab) {
    serviceLabCandidates = buildServiceLabCandidates({
      weekStartDate,
      decisions: weeklyKpi?.decisions || [],
      memory: revenueMemory,
      maxCandidates: clampInt(args.serviceCandidateLimit, 1, 10, 5),
    });
    await persistServiceLabCandidates({
      uid: args.uid,
      dateKey,
      candidates: serviceLabCandidates,
    });
  }

  const dailyDigest = buildDailyExecutiveDigest({
    dateKey,
    timeZone,
    day2,
    weeklyKpi,
    closerQueue,
    posStatus,
  });
  await persistDailyDigest({
    uid: args.uid,
    digest: dailyDigest,
  });

  const result: Day30RevenueAutomationResult = {
    uid: args.uid,
    dateKey,
    timeZone,
    cadence: {
      runWeeklyKpi,
      runServiceLab,
      runCloserQueue,
      runRevenueMemory,
    },
    day2,
    weeklyKpi: weeklyKpi
      ? {
          weekStartDate: weeklyKpi.weekStartDate,
          closeRatePct: weeklyKpi.summary.closeRatePct,
          dealsWon: weeklyKpi.summary.dealsWon,
          decisionSummary: weeklyKpi.decisionSummary,
        }
      : null,
    revenueMemory,
    closerQueue,
    serviceLab: runServiceLab
      ? {
          generated: serviceLabCandidates.length,
          candidateIds: serviceLabCandidates.map((candidate) => candidate.candidateId),
        }
      : null,
    dailyDigest,
    warnings,
  };

  args.log.info("revenue.day30.completed", {
    uid: args.uid,
    dateKey,
    templatesSucceeded: day2.totals.templatesSucceeded,
    leadsScored: day2.totals.leadsScored,
    closerQueueSize: closerQueue?.queueSize || 0,
    serviceCandidates: serviceLabCandidates.length,
    warnings: warnings.length,
  });

  return result;
}
