import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  CRM_PIPELINE_STAGE_ORDER,
  DEFAULT_OFFER_CODE_BY_BUSINESS,
  isDepositStage,
  isWonStage,
  normalizeBusinessUnit,
  normalizeCrmPipelineStage,
  normalizeOfferCode,
  type BusinessUnitId,
  type CrmPipelineStage,
} from "@/lib/revenue/offers";
import type { Logger } from "@/lib/logging";

const DEFAULT_TIME_ZONE = "America/Chicago";
const MAX_LEAD_SCAN = 5000;

const STAGE_INDEX: Record<CrmPipelineStage, number> = CRM_PIPELINE_STAGE_ORDER.reduce(
  (acc, stage, index) => {
    acc[stage] = index;
    return acc;
  },
  {} as Record<CrmPipelineStage, number>
);

export interface WeeklyLeadSnapshot {
  leadId: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  pipelineStage: CrmPipelineStage;
  createdAt: Date | null;
  updatedAt: Date | null;
  valueUsd: number;
}

export interface WeeklyKpiSegment {
  businessUnit: BusinessUnitId;
  offerCode: string;
  leadsSourced: number;
  qualifiedLeads: number;
  outreachReady: number;
  meetingsBooked: number;
  depositsCollected: number;
  dealsWon: number;
  closeRatePct: number;
  avgCycleDaysToDeposit: number | null;
  pipelineValueUsd: number;
}

export interface WeeklyKpiSummary {
  leadsSourced: number;
  qualifiedLeads: number;
  outreachReady: number;
  meetingsBooked: number;
  depositsCollected: number;
  dealsWon: number;
  closeRatePct: number;
  avgCycleDaysToDeposit: number | null;
  pipelineValueUsd: number;
}

export type WeeklyKpiDecisionAction = "scale" | "fix" | "kill" | "watch";

export interface WeeklyKpiDecision {
  decisionId: string;
  weekStartDate: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
  action: WeeklyKpiDecisionAction;
  reason: string;
  streakWeeks: number;
  leadsSourced: number;
  closeRatePct: number;
  meetingRatePct: number;
  depositRateFromMeetingsPct: number;
  cycleDaysToDeposit: number | null;
}

export interface WeeklyKpiDecisionSummary {
  scale: number;
  fix: number;
  kill: number;
  watch: number;
}

export interface WeeklyKpiReport {
  uid: string;
  timeZone: string;
  weekStartDate: string;
  weekEndDate: string;
  scannedLeadCount: number;
  sampled: boolean;
  summary: WeeklyKpiSummary;
  segments: WeeklyKpiSegment[];
  decisions: WeeklyKpiDecision[];
  decisionSummary: WeeklyKpiDecisionSummary;
}

interface WeeklyKpiRollupArgs {
  uid: string;
  timeZone?: string;
  weekStartDate?: string;
  log: Logger;
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

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const key = formatter.format(date);
  return key;
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

function normalizeDateKey(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function shiftDateKey(dateKey: string, days: number): string {
  const baseline = new Date(`${dateKey}T00:00:00.000Z`);
  baseline.setUTCDate(baseline.getUTCDate() + days);
  return baseline.toISOString().slice(0, 10);
}

function currentWeekWindow(timeZone: string, now: Date = new Date()): {
  weekStartDate: string;
  weekEndDate: string;
} {
  const today = dateKeyInTimeZone(now, timeZone);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const weekStartDate = shiftDateKey(today, -daysSinceMonday);
  return {
    weekStartDate,
    weekEndDate: shiftDateKey(weekStartDate, 6),
  };
}

function inDateWindow(dateKey: string, weekStartDate: string, weekEndDate: string): boolean {
  return dateKey >= weekStartDate && dateKey <= weekEndDate;
}

function stageAtLeast(stage: CrmPipelineStage, minimum: CrmPipelineStage): boolean {
  return STAGE_INDEX[stage] >= STAGE_INDEX[minimum];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarizeCycles(cycleDays: number[]): number | null {
  if (cycleDays.length === 0) return null;
  const total = cycleDays.reduce((sum, value) => sum + value, 0);
  return round2(total / cycleDays.length);
}

function buildSegmentKey(segment: Pick<WeeklyKpiSegment, "businessUnit" | "offerCode">): string {
  return `${segment.businessUnit}:${segment.offerCode}`;
}

function normalizeSegment(raw: unknown): WeeklyKpiSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const businessUnit = normalizeBusinessUnit(row.businessUnit);
  const offerCode =
    normalizeOfferCode(row.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];

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

function streakLength(
  samples: WeeklyKpiSegment[],
  predicate: (segment: WeeklyKpiSegment) => boolean
): number {
  let streak = 0;
  for (const sample of samples) {
    if (!predicate(sample)) break;
    streak += 1;
  }
  return streak;
}

function ratioPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round2((numerator / denominator) * 100);
}

function decisionId(args: {
  weekStartDate: string;
  businessUnit: BusinessUnitId;
  offerCode: string;
}): string {
  return `${args.weekStartDate}:${args.businessUnit}:${args.offerCode}`;
}

function summarizeDecisionCounts(decisions: WeeklyKpiDecision[]): WeeklyKpiDecisionSummary {
  return decisions.reduce<WeeklyKpiDecisionSummary>(
    (acc, decision) => {
      acc[decision.action] += 1;
      return acc;
    },
    { scale: 0, fix: 0, kill: 0, watch: 0 }
  );
}

function buildSegmentDecision(args: {
  weekStartDate: string;
  segment: WeeklyKpiSegment;
  history: WeeklyKpiSegment[];
}): WeeklyKpiDecision {
  const meetingRatePct = ratioPercent(args.segment.meetingsBooked, args.segment.leadsSourced);
  const depositRateFromMeetingsPct = ratioPercent(
    args.segment.depositsCollected,
    args.segment.meetingsBooked
  );
  const cycleDays = args.segment.avgCycleDaysToDeposit;
  const sequence = [args.segment, ...args.history];
  const scaleStreak = streakLength(
    sequence,
    (sample) =>
      sample.leadsSourced > 0 &&
      sample.closeRatePct >= 20 &&
      (sample.avgCycleDaysToDeposit ?? Number.POSITIVE_INFINITY) <= 14
  );
  const killStreak = streakLength(
    sequence,
    (sample) => sample.leadsSourced >= 30 && sample.closeRatePct < 5
  );

  let action: WeeklyKpiDecisionAction = "watch";
  let reason = "No threshold crossed; keep monitoring and maintain current cadence.";
  let streakWeeks = 0;

  if (killStreak >= 3) {
    action = "kill";
    reason = "Close rate stayed below 5% for 3 consecutive weeks with >=30 leads.";
    streakWeeks = killStreak;
  } else if (scaleStreak >= 2) {
    action = "scale";
    reason = "Close rate >=20% and cycle <=14 days for 2+ consecutive weeks.";
    streakWeeks = scaleStreak;
  } else if (meetingRatePct >= 15 && depositRateFromMeetingsPct < 25) {
    action = "fix";
    reason = "Meeting rate is healthy but proposal/deposit conversion is below 25%.";
    streakWeeks = 1;
  }

  return {
    decisionId: decisionId({
      weekStartDate: args.weekStartDate,
      businessUnit: args.segment.businessUnit,
      offerCode: args.segment.offerCode,
    }),
    weekStartDate: args.weekStartDate,
    businessUnit: args.segment.businessUnit,
    offerCode: args.segment.offerCode,
    action,
    reason,
    streakWeeks,
    leadsSourced: args.segment.leadsSourced,
    closeRatePct: args.segment.closeRatePct,
    meetingRatePct,
    depositRateFromMeetingsPct,
    cycleDaysToDeposit: cycleDays,
  };
}

export function buildWeeklyKpiDecisions(args: {
  weekStartDate: string;
  segments: WeeklyKpiSegment[];
  historyBySegment?: Map<string, WeeklyKpiSegment[]>;
}): {
  decisions: WeeklyKpiDecision[];
  decisionSummary: WeeklyKpiDecisionSummary;
} {
  const historyBySegment = args.historyBySegment || new Map<string, WeeklyKpiSegment[]>();

  const decisions = args.segments.map((segment) => {
    const key = buildSegmentKey(segment);
    const history = historyBySegment.get(key) || [];
    return buildSegmentDecision({
      weekStartDate: args.weekStartDate,
      segment,
      history,
    });
  });

  const decisionSummary = summarizeDecisionCounts(decisions);
  return { decisions, decisionSummary };
}

export function summarizeWeeklyLeads(args: {
  leads: WeeklyLeadSnapshot[];
  timeZone: string;
  weekStartDate: string;
  weekEndDate: string;
}): {
  summary: WeeklyKpiSummary;
  segments: WeeklyKpiSegment[];
} {
  const totals: WeeklyKpiSummary = {
    leadsSourced: 0,
    qualifiedLeads: 0,
    outreachReady: 0,
    meetingsBooked: 0,
    depositsCollected: 0,
    dealsWon: 0,
    closeRatePct: 0,
    avgCycleDaysToDeposit: null,
    pipelineValueUsd: 0,
  };

  const segmentMap = new Map<
    string,
    WeeklyKpiSegment & {
      _cycleDays: number[];
    }
  >();
  const totalCycleDays: number[] = [];

  for (const lead of args.leads) {
    if (!lead.createdAt) continue;
    const createdKey = dateKeyInTimeZone(lead.createdAt, args.timeZone);
    if (!inDateWindow(createdKey, args.weekStartDate, args.weekEndDate)) continue;

    const segmentKey = `${lead.businessUnit}:${lead.offerCode}`;
    const segment =
      segmentMap.get(segmentKey) ||
      {
        businessUnit: lead.businessUnit,
        offerCode: lead.offerCode,
        leadsSourced: 0,
        qualifiedLeads: 0,
        outreachReady: 0,
        meetingsBooked: 0,
        depositsCollected: 0,
        dealsWon: 0,
        closeRatePct: 0,
        avgCycleDaysToDeposit: null,
        pipelineValueUsd: 0,
        _cycleDays: [],
      };

    const stage = lead.pipelineStage;
    const qualified = stageAtLeast(stage, "qualification");
    const outreachReady = stageAtLeast(stage, "outreach");
    const meetingsBooked = stageAtLeast(stage, "booking");
    const deposit = isDepositStage(stage) || isWonStage(stage);
    const won = stage === "won";

    totals.leadsSourced += 1;
    segment.leadsSourced += 1;

    if (qualified) {
      totals.qualifiedLeads += 1;
      segment.qualifiedLeads += 1;
    }
    if (outreachReady) {
      totals.outreachReady += 1;
      segment.outreachReady += 1;
    }
    if (meetingsBooked) {
      totals.meetingsBooked += 1;
      segment.meetingsBooked += 1;
    }
    if (deposit) {
      totals.depositsCollected += 1;
      segment.depositsCollected += 1;

      if (lead.updatedAt) {
        const cycleDays = (lead.updatedAt.getTime() - lead.createdAt.getTime()) / (24 * 60 * 60 * 1000);
        if (cycleDays >= 0) {
          totalCycleDays.push(cycleDays);
          segment._cycleDays.push(cycleDays);
        }
      }
    }
    if (won) {
      totals.dealsWon += 1;
      segment.dealsWon += 1;
    }

    totals.pipelineValueUsd += lead.valueUsd;
    segment.pipelineValueUsd += lead.valueUsd;

    segmentMap.set(segmentKey, segment);
  }

  totals.closeRatePct = totals.leadsSourced
    ? round2((totals.dealsWon / totals.leadsSourced) * 100)
    : 0;
  totals.pipelineValueUsd = round2(totals.pipelineValueUsd);
  totals.avgCycleDaysToDeposit = summarizeCycles(totalCycleDays);

  const segments = Array.from(segmentMap.values())
    .map((segment) => ({
      businessUnit: segment.businessUnit,
      offerCode: segment.offerCode,
      leadsSourced: segment.leadsSourced,
      qualifiedLeads: segment.qualifiedLeads,
      outreachReady: segment.outreachReady,
      meetingsBooked: segment.meetingsBooked,
      depositsCollected: segment.depositsCollected,
      dealsWon: segment.dealsWon,
      closeRatePct: segment.leadsSourced
        ? round2((segment.dealsWon / segment.leadsSourced) * 100)
        : 0,
      avgCycleDaysToDeposit: summarizeCycles(segment._cycleDays),
      pipelineValueUsd: round2(segment.pipelineValueUsd),
    }))
    .sort((a, b) => {
      if (b.dealsWon !== a.dealsWon) return b.dealsWon - a.dealsWon;
      if (b.depositsCollected !== a.depositsCollected) return b.depositsCollected - a.depositsCollected;
      return b.leadsSourced - a.leadsSourced;
    });

  return { summary: totals, segments };
}

export async function runWeeklyKpiRollup(args: WeeklyKpiRollupArgs): Promise<WeeklyKpiReport> {
  const timeZone = normalizeTimeZone(args.timeZone);
  const requestedWeekStart = normalizeDateKey(asString(args.weekStartDate || ""));
  const window = requestedWeekStart
    ? {
        weekStartDate: requestedWeekStart,
        weekEndDate: shiftDateKey(requestedWeekStart, 6),
      }
    : currentWeekWindow(timeZone);

  const leadsSnap = await getAdminDb()
    .collection("leads")
    .where("userId", "==", args.uid)
    .limit(MAX_LEAD_SCAN)
    .get();

  const leads: WeeklyLeadSnapshot[] = leadsSnap.docs.map((docSnap) => {
    const data = (docSnap.data() || {}) as Record<string, unknown>;
    const businessUnit = normalizeBusinessUnit(data.businessUnit);
    const offerCode =
      normalizeOfferCode(data.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];
    return {
      leadId: docSnap.id,
      businessUnit,
      offerCode,
      pipelineStage: normalizeCrmPipelineStage(data.pipelineStage || data.status),
      createdAt: asDate(data.createdAt),
      updatedAt: asDate(data.updatedAt),
      valueUsd: safeNumber(data.value),
    };
  });

  const { summary, segments } = summarizeWeeklyLeads({
    leads,
    timeZone,
    weekStartDate: window.weekStartDate,
    weekEndDate: window.weekEndDate,
  });

  const reportsRoot = getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("revenue_kpi_reports");

  const historyWeekStartDates = [
    shiftDateKey(window.weekStartDate, -7),
    shiftDateKey(window.weekStartDate, -14),
  ];
  const historyBySegment = new Map<string, WeeklyKpiSegment[]>();
  const historyDocs = await Promise.all(
    historyWeekStartDates.map((weekStartDate) => reportsRoot.doc(weekStartDate).get())
  );
  for (const snap of historyDocs) {
    if (!snap.exists) continue;
    const data = (snap.data() || {}) as Record<string, unknown>;
    const historicalSegments = Array.isArray(data.segments) ? data.segments : [];
    for (const row of historicalSegments) {
      const segment = normalizeSegment(row);
      if (!segment) continue;
      const key = buildSegmentKey(segment);
      const existing = historyBySegment.get(key) || [];
      existing.push(segment);
      historyBySegment.set(key, existing);
    }
  }

  const { decisions, decisionSummary } = buildWeeklyKpiDecisions({
    weekStartDate: window.weekStartDate,
    segments,
    historyBySegment,
  });

  const report: WeeklyKpiReport = {
    uid: args.uid,
    timeZone,
    weekStartDate: window.weekStartDate,
    weekEndDate: window.weekEndDate,
    scannedLeadCount: leads.length,
    sampled: leads.length >= MAX_LEAD_SCAN,
    summary,
    segments,
    decisions,
    decisionSummary,
  };

  await reportsRoot.doc(window.weekStartDate).set(
    {
      ...report,
      generatedAt: FieldValue.serverTimestamp(),
      source: "weekly_kpi_rollup_v2",
    },
    { merge: true }
  );

  await reportsRoot.doc("latest").set(
    {
      ...report,
      generatedAt: FieldValue.serverTimestamp(),
      source: "weekly_kpi_rollup_v2",
    },
    { merge: true }
  );

  const decisionsRoot = getAdminDb()
    .collection("identities")
    .doc(args.uid)
    .collection("revenue_kpi_decisions");
  await decisionsRoot.doc(window.weekStartDate).set(
    {
      uid: args.uid,
      weekStartDate: window.weekStartDate,
      weekEndDate: window.weekEndDate,
      decisions,
      decisionSummary,
      generatedAt: FieldValue.serverTimestamp(),
      source: "weekly_kpi_rollup_v2",
    },
    { merge: true }
  );
  await decisionsRoot.doc("latest").set(
    {
      uid: args.uid,
      weekStartDate: window.weekStartDate,
      weekEndDate: window.weekEndDate,
      decisions,
      decisionSummary,
      generatedAt: FieldValue.serverTimestamp(),
      source: "weekly_kpi_rollup_v2",
    },
    { merge: true }
  );

  args.log.info("revenue.kpi.weekly.generated", {
    uid: args.uid,
    weekStartDate: window.weekStartDate,
    weekEndDate: window.weekEndDate,
    leadsSourced: report.summary.leadsSourced,
    depositsCollected: report.summary.depositsCollected,
    dealsWon: report.summary.dealsWon,
    decisionsScale: report.decisionSummary.scale,
    decisionsFix: report.decisionSummary.fix,
    decisionsKill: report.decisionSummary.kill,
  });

  return report;
}
