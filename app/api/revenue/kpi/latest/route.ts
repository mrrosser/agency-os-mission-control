import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      return candidate.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeSummary(value: unknown) {
  const summary = (value || {}) as Record<string, unknown>;
  return {
    leadsSourced: asNumber(summary.leadsSourced),
    qualifiedLeads: asNumber(summary.qualifiedLeads),
    outreachReady: asNumber(summary.outreachReady),
    meetingsBooked: asNumber(summary.meetingsBooked),
    depositsCollected: asNumber(summary.depositsCollected),
    dealsWon: asNumber(summary.dealsWon),
    closeRatePct: asNumber(summary.closeRatePct),
    avgCycleDaysToDeposit:
      summary.avgCycleDaysToDeposit === null || summary.avgCycleDaysToDeposit === undefined
        ? null
        : asNumber(summary.avgCycleDaysToDeposit),
    pipelineValueUsd: asNumber(summary.pipelineValueUsd),
  };
}

function normalizeDecisionSummary(value: unknown) {
  const summary = (value || {}) as Record<string, unknown>;
  return {
    scale: asNumber(summary.scale),
    fix: asNumber(summary.fix),
    kill: asNumber(summary.kill),
    watch: asNumber(summary.watch),
  };
}

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    const user = await requireFirebaseAuth(request, log);
    const ref = getAdminDb()
      .collection("identities")
      .doc(user.uid)
      .collection("revenue_kpi_reports")
      .doc("latest");
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({
        ok: true,
        report: null,
        correlationId,
      });
    }

    const data = (snap.data() || {}) as Record<string, unknown>;
    const report = {
      uid: user.uid,
      timeZone: typeof data.timeZone === "string" ? data.timeZone : "America/Chicago",
      weekStartDate: typeof data.weekStartDate === "string" ? data.weekStartDate : null,
      weekEndDate: typeof data.weekEndDate === "string" ? data.weekEndDate : null,
      generatedAt: toIso(data.generatedAt),
      scannedLeadCount: asNumber(data.scannedLeadCount),
      sampled: Boolean(data.sampled),
      summary: normalizeSummary(data.summary),
      decisionSummary: normalizeDecisionSummary(data.decisionSummary),
    };

    return NextResponse.json({
      ok: true,
      report,
      correlationId,
    });
  },
  { route: "revenue.kpi.latest.get" }
);
