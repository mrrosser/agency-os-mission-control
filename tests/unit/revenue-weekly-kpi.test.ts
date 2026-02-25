import { describe, expect, it } from "vitest";
import {
  buildWeeklyKpiDecisions,
  summarizeWeeklyLeads,
  type WeeklyKpiSegment,
  type WeeklyLeadSnapshot,
} from "@/lib/revenue/weekly-kpi";

describe("revenue weekly kpi summary", () => {
  it("summarizes weekly lead metrics by stage and offer", () => {
    const leads: WeeklyLeadSnapshot[] = [
      {
        leadId: "lead-1",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        pipelineStage: "won",
        createdAt: new Date("2026-02-23T12:00:00.000Z"),
        updatedAt: new Date("2026-02-25T12:00:00.000Z"),
        valueUsd: 2500,
      },
      {
        leadId: "lead-2",
        businessUnit: "rt_solutions",
        offerCode: "RTS-QUICK-WEBSITE-SPRINT",
        pipelineStage: "deposit_received",
        createdAt: new Date("2026-02-24T12:00:00.000Z"),
        updatedAt: new Date("2026-02-26T12:00:00.000Z"),
        valueUsd: 1800,
      },
      {
        leadId: "lead-3",
        businessUnit: "rosser_nft_gallery",
        offerCode: "RNG-MINI-REPLICA",
        pipelineStage: "qualification",
        createdAt: new Date("2026-02-27T12:00:00.000Z"),
        updatedAt: new Date("2026-02-27T12:00:00.000Z"),
        valueUsd: 300,
      },
      {
        leadId: "lead-old",
        businessUnit: "rosser_nft_gallery",
        offerCode: "RNG-MINI-REPLICA",
        pipelineStage: "won",
        createdAt: new Date("2026-02-10T12:00:00.000Z"),
        updatedAt: new Date("2026-02-11T12:00:00.000Z"),
        valueUsd: 999,
      },
    ];

    const result = summarizeWeeklyLeads({
      leads,
      timeZone: "America/Chicago",
      weekStartDate: "2026-02-23",
      weekEndDate: "2026-03-01",
    });

    expect(result.summary.leadsSourced).toBe(3);
    expect(result.summary.qualifiedLeads).toBe(3);
    expect(result.summary.outreachReady).toBe(2);
    expect(result.summary.meetingsBooked).toBe(2);
    expect(result.summary.depositsCollected).toBe(2);
    expect(result.summary.dealsWon).toBe(1);
    expect(result.summary.closeRatePct).toBeCloseTo(33.33, 2);
    expect(result.summary.pipelineValueUsd).toBe(4600);
    expect(result.summary.avgCycleDaysToDeposit).toBe(2);

    expect(result.segments).toHaveLength(2);
    const rtSegment = result.segments.find((segment) => segment.offerCode === "RTS-QUICK-WEBSITE-SPRINT");
    expect(rtSegment).toBeDefined();
    expect(rtSegment?.depositsCollected).toBe(2);
    expect(rtSegment?.dealsWon).toBe(1);
  });

  it("marks segment for scale when two-week streak meets thresholds", () => {
    const current: WeeklyKpiSegment = {
      businessUnit: "rt_solutions",
      offerCode: "RTS-QUICK-WEBSITE-SPRINT",
      leadsSourced: 20,
      qualifiedLeads: 15,
      outreachReady: 14,
      meetingsBooked: 8,
      depositsCollected: 6,
      dealsWon: 5,
      closeRatePct: 25,
      avgCycleDaysToDeposit: 8,
      pipelineValueUsd: 18000,
    };
    const prior: WeeklyKpiSegment = {
      ...current,
      leadsSourced: 18,
      closeRatePct: 22,
      avgCycleDaysToDeposit: 10,
    };

    const result = buildWeeklyKpiDecisions({
      weekStartDate: "2026-02-23",
      segments: [current],
      historyBySegment: new Map([["rt_solutions:RTS-QUICK-WEBSITE-SPRINT", [prior]]]),
    });

    expect(result.decisionSummary.scale).toBe(1);
    expect(result.decisions[0]?.action).toBe("scale");
    expect(result.decisions[0]?.streakWeeks).toBeGreaterThanOrEqual(2);
  });

  it("marks segment for kill when three-week low-close streak persists", () => {
    const current: WeeklyKpiSegment = {
      businessUnit: "rosser_nft_gallery",
      offerCode: "RNG-PRIVATE-EVENT-RENTAL",
      leadsSourced: 45,
      qualifiedLeads: 20,
      outreachReady: 20,
      meetingsBooked: 8,
      depositsCollected: 0,
      dealsWon: 1,
      closeRatePct: 2.2,
      avgCycleDaysToDeposit: 21,
      pipelineValueUsd: 9000,
    };
    const historyA: WeeklyKpiSegment = { ...current, closeRatePct: 4.8, dealsWon: 1 };
    const historyB: WeeklyKpiSegment = { ...current, closeRatePct: 3.1, dealsWon: 1 };

    const result = buildWeeklyKpiDecisions({
      weekStartDate: "2026-02-23",
      segments: [current],
      historyBySegment: new Map([
        ["rosser_nft_gallery:RNG-PRIVATE-EVENT-RENTAL", [historyA, historyB]],
      ]),
    });

    expect(result.decisionSummary.kill).toBe(1);
    expect(result.decisions[0]?.action).toBe("kill");
    expect(result.decisions[0]?.streakWeeks).toBeGreaterThanOrEqual(3);
  });
});
