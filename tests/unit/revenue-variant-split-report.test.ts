import { describe, expect, it } from "vitest";
import {
  classifyVariantDecisions,
  parseDecisionThresholdsFromEnv,
} from "@/scripts/revenue-variant-split-report.mjs";

function row(overrides: Partial<Record<string, unknown>>) {
  return {
    templateId: "rts-south-day1",
    baseTemplateId: "rts-south-day1",
    variant: "A",
    runs: 4,
    candidateTotal: 40,
    scoredTotal: 20,
    filteredOut: 20,
    processedLeads: 40,
    meetingsScheduled: 8,
    emailsDrafted: 36,
    noEmail: 4,
    failedLeads: 2,
    lastRunAt: "2026-02-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("revenue variant split report decisions", () => {
  it("classifies keep/fix/kill/watch deterministically against control", () => {
    const aggregated = [
      row({ templateId: "rts-south-day1", variant: "A" }),
      row({
        templateId: "rts-south-day1-exp-b",
        variant: "B",
        runs: 4,
        candidateTotal: 42,
        scoredTotal: 24,
        processedLeads: 42,
        meetingsScheduled: 14,
        failedLeads: 1,
      }),
      row({
        templateId: "rts-south-day1-exp-c",
        variant: "C",
        runs: 6,
        candidateTotal: 40,
        scoredTotal: 9,
        processedLeads: 40,
        meetingsScheduled: 1,
        failedLeads: 12,
      }),
      row({
        templateId: "rts-south-day1-exp-d",
        variant: "D",
        runs: 5,
        candidateTotal: 40,
        scoredTotal: 18,
        processedLeads: 40,
        meetingsScheduled: 8,
        failedLeads: 5,
      }),
      row({
        templateId: "rts-south-day1-exp-e",
        variant: "E",
        runs: 1,
        candidateTotal: 7,
        scoredTotal: 3,
        processedLeads: 7,
        meetingsScheduled: 1,
        failedLeads: 0,
      }),
    ];

    const { decisions, decisionSummary } = classifyVariantDecisions({
      aggregated,
      thresholds: parseDecisionThresholdsFromEnv({}),
    });

    expect(decisions.find((decision) => decision.templateId === "rts-south-day1")?.action).toBe(
      "keep"
    );
    expect(decisions.find((decision) => decision.templateId === "rts-south-day1-exp-b")?.action).toBe(
      "keep"
    );
    expect(decisions.find((decision) => decision.templateId === "rts-south-day1-exp-c")?.action).toBe(
      "kill"
    );
    expect(decisions.find((decision) => decision.templateId === "rts-south-day1-exp-d")?.action).toBe(
      "fix"
    );
    expect(decisions.find((decision) => decision.templateId === "rts-south-day1-exp-e")?.action).toBe(
      "watch"
    );
    expect(decisionSummary).toEqual({
      keep: 2,
      fix: 1,
      kill: 1,
      watch: 1,
    });
  });

  it("falls back to keep when only one non-control variant exists", () => {
    const aggregated = [
      row({
        templateId: "rng-south-day1-exp-b",
        baseTemplateId: "rng-south-day1",
        variant: "B",
        runs: 3,
        processedLeads: 15,
      }),
    ];

    const { decisions } = classifyVariantDecisions({
      aggregated,
      thresholds: parseDecisionThresholdsFromEnv({}),
    });

    expect(decisions[0]?.action).toBe("keep");
    expect(String(decisions[0]?.reason || "").toLowerCase()).toContain("baseline");
  });
});
