import { describe, expect, it } from "vitest";
import type { WeeklyKpiDecision } from "@/lib/revenue/weekly-kpi";
import {
  buildDailyExecutiveDigest,
  buildHotCloserQueueEntries,
  buildServiceLabCandidates,
  summarizeRevenueMemoryFromSignals,
  type RevenueLeadSignal,
} from "@/lib/revenue/day30-automation";

describe("revenue day30 automation helpers", () => {
  it("summarizes win/loss and objection reasons from recent signals", () => {
    const nowMs = Date.parse("2026-02-25T12:00:00.000Z");
    const leads: RevenueLeadSignal[] = [
      {
        leadId: "lead-1",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        pipelineStage: "won",
        valueUsd: 2500,
        createdAt: new Date("2026-02-22T10:00:00.000Z"),
        updatedAt: new Date("2026-02-24T10:00:00.000Z"),
        winReason: "Fast timeline",
        lossReason: null,
        objectionReason: "timing",
      },
      {
        leadId: "lead-2",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        pipelineStage: "lost",
        valueUsd: 1800,
        createdAt: new Date("2026-02-21T10:00:00.000Z"),
        updatedAt: new Date("2026-02-25T09:00:00.000Z"),
        winReason: null,
        lossReason: "Budget",
        objectionReason: "price",
      },
      {
        leadId: "lead-3",
        businessUnit: "rosser_nft_gallery",
        offerCode: "RNG-MINI-REPLICA",
        pipelineStage: "booking",
        valueUsd: 400,
        createdAt: new Date("2026-02-25T08:00:00.000Z"),
        updatedAt: new Date("2026-02-25T09:30:00.000Z"),
        winReason: null,
        lossReason: null,
        objectionReason: null,
      },
    ];

    const summary = summarizeRevenueMemoryFromSignals({
      leads,
      weekStartDate: "2026-02-23",
      lookbackDays: 14,
      nowMs,
    });

    expect(summary.consideredLeads).toBe(3);
    expect(summary.wonCount).toBe(1);
    expect(summary.lostCount).toBe(1);
    expect(summary.openCount).toBe(1);
    expect(summary.winReasons[0]?.reason).toBe("Fast timeline");
    expect(summary.lossReasons[0]?.reason).toBe("Budget");
    expect(summary.objectionReasons[0]?.count).toBe(1);
  });

  it("builds closer queue entries with SLA breach tracking", () => {
    const nowMs = Date.parse("2026-02-25T12:00:00.000Z");
    const leads: RevenueLeadSignal[] = [
      {
        leadId: "proposal-hot",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        pipelineStage: "proposal",
        valueUsd: 5000,
        createdAt: new Date("2026-02-24T08:00:00.000Z"),
        updatedAt: new Date("2026-02-25T11:00:00.000Z"),
        winReason: null,
        lossReason: null,
        objectionReason: null,
      },
      {
        leadId: "booking-old",
        businessUnit: "rosser_nft_gallery",
        offerCode: "RNG-MINI-REPLICA",
        pipelineStage: "booking",
        valueUsd: 300,
        createdAt: new Date("2026-02-23T08:00:00.000Z"),
        updatedAt: new Date("2026-02-25T09:00:00.000Z"),
        winReason: null,
        lossReason: null,
        objectionReason: null,
      },
    ];

    const queue = buildHotCloserQueueEntries({
      leads,
      nowMs,
      lookbackHours: 72,
      slaMinutes: 30,
    });

    expect(queue).toHaveLength(2);
    expect(queue[0]?.leadId).toBe("proposal-hot");
    expect(queue[0]?.priority).toBe("high");
    expect(queue[0]?.breached).toBe(true);
  });

  it("creates service candidates from weekly decisions", () => {
    const decisions: WeeklyKpiDecision[] = [
      {
        decisionId: "d-1",
        weekStartDate: "2026-02-23",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        action: "scale",
        reason: "Strong close rate",
        streakWeeks: 2,
        leadsSourced: 30,
        closeRatePct: 24,
        meetingRatePct: 18,
        depositRateFromMeetingsPct: 45,
        cycleDaysToDeposit: 8,
      },
    ];

    const candidates = buildServiceLabCandidates({
      weekStartDate: "2026-02-23",
      decisions,
      memory: null,
      maxCandidates: 5,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.action).toBe("scale");
    expect(candidates[0]?.targetBusiness).toBe("rt_solutions");
  });

  it("builds daily digest summary from loop outputs", () => {
    const digest = buildDailyExecutiveDigest({
      dateKey: "2026-02-25",
      timeZone: "America/Chicago",
      day2: {
        uid: "user-1",
        dateKey: "2026-02-25",
        dryRun: false,
        processDueResponses: true,
        requireApprovalGates: true,
        templates: [],
        totals: {
          templatesAttempted: 3,
          templatesSucceeded: 3,
          leadsScored: 24,
          followupsSeeded: 20,
          responseProcessed: 6,
          responseCompleted: 5,
          responseSkipped: 1,
          responseFailed: 1,
        },
        warnings: [],
      },
      weeklyKpi: {
        uid: "user-1",
        timeZone: "America/Chicago",
        weekStartDate: "2026-02-23",
        weekEndDate: "2026-03-01",
        scannedLeadCount: 100,
        sampled: false,
        summary: {
          leadsSourced: 40,
          qualifiedLeads: 26,
          outreachReady: 22,
          meetingsBooked: 12,
          depositsCollected: 6,
          dealsWon: 5,
          closeRatePct: 12.5,
          avgCycleDaysToDeposit: 9,
          pipelineValueUsd: 28000,
        },
        segments: [],
        decisions: [],
        decisionSummary: {
          scale: 1,
          fix: 1,
          kill: 0,
          watch: 0,
        },
      },
      closerQueue: {
        scannedLeads: 100,
        queueSize: 4,
        breachedCount: 2,
        highPriorityCount: 2,
        generatedAt: "2026-02-25T12:00:00.000Z",
      },
      posStatus: {
        generatedAt: "2026-02-25T12:00:00.000Z",
        uid: "user-1",
        policy: {
          allowSideEffects: false,
          autoApproveLowRisk: true,
          requireApprovalForHighRisk: true,
        },
        supportedEventPrefixes: ["PAYMENT.", "INVOICE.", "REFUND.", "ORDER."],
        summary: {
          health: "degraded",
          detail: "blocked",
          queuedEvents: 0,
          processingEvents: 0,
          blockedEvents: 2,
          deadLetterEvents: 0,
          completedEvents: 10,
          oldestPendingSeconds: 1200,
          outboxQueued: 1,
          lastWebhookAt: null,
          lastProcessedAt: null,
          lastRunAt: null,
        },
      },
    });

    expect(digest.summary.templatesSucceeded).toBe(3);
    expect(digest.summary.pendingApprovals).toBe(2);
    expect(digest.blockers.length).toBeGreaterThan(0);
    expect(digest.topPriorities.length).toBeGreaterThan(0);
  });
});
