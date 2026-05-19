import { describe, expect, it } from "vitest";
import {
  evaluateOutcomeGatesFromSummary,
  isOutcomeGateReady,
  summarizeConsecutiveOutcomeGateReadiness,
} from "@/lib/revenue/outcome-gates";

describe("revenue outcome gates", () => {
  it("evaluates canonical gate thresholds at pass/warn/fail boundaries", () => {
    const passCase = evaluateOutcomeGatesFromSummary({
      leadsSourced: 10,
      qualifiedLeads: 2,
      meetingsBooked: 2,
      depositsCollected: 1,
      pipelineValueUsd: 5000,
    });
    const warnCase = evaluateOutcomeGatesFromSummary({
      leadsSourced: 5,
      qualifiedLeads: 1,
      meetingsBooked: 1,
      depositsCollected: 0,
      pipelineValueUsd: 2000,
    });
    const failCase = evaluateOutcomeGatesFromSummary({
      leadsSourced: 4,
      qualifiedLeads: 0,
      meetingsBooked: 0,
      depositsCollected: 0,
      pipelineValueUsd: 1999,
    });

    expect(passCase.gates.find((gate) => gate.id === "throughput")?.status).toBe("pass");
    expect(passCase.gates.find((gate) => gate.id === "qualification")?.status).toBe("pass");
    expect(passCase.gates.find((gate) => gate.id === "meeting")?.status).toBe("pass");
    expect(passCase.gates.find((gate) => gate.id === "revenue")?.status).toBe("pass");
    expect(passCase.gates.find((gate) => gate.id === "pipeline")?.status).toBe("pass");

    expect(warnCase.gates.find((gate) => gate.id === "throughput")?.status).toBe("warn");
    expect(warnCase.gates.find((gate) => gate.id === "qualification")?.status).toBe("pass");
    expect(warnCase.gates.find((gate) => gate.id === "meeting")?.status).toBe("pass");
    expect(warnCase.gates.find((gate) => gate.id === "revenue")?.status).toBe("fail");
    expect(warnCase.gates.find((gate) => gate.id === "pipeline")?.status).toBe("warn");

    expect(failCase.gates.find((gate) => gate.id === "throughput")?.status).toBe("fail");
    expect(failCase.gates.find((gate) => gate.id === "qualification")?.status).toBe("fail");
    expect(failCase.gates.find((gate) => gate.id === "meeting")?.status).toBe("fail");
    expect(failCase.gates.find((gate) => gate.id === "revenue")?.status).toBe("fail");
    expect(failCase.gates.find((gate) => gate.id === "pipeline")?.status).toBe("fail");
  });

  it("builds gate summary counts and critical gate failures", () => {
    const evaluation = evaluateOutcomeGatesFromSummary({
      leadsSourced: 4,
      qualifiedLeads: 2,
      meetingsBooked: 1,
      depositsCollected: 0,
      pipelineValueUsd: 2500,
    });

    expect(evaluation.summary.passCount).toBe(2);
    expect(evaluation.summary.warnCount).toBe(1);
    expect(evaluation.summary.failCount).toBe(2);
    expect(evaluation.summary.passOrWarnCount).toBe(3);
    expect(evaluation.criticalGateFailures).toContain("throughput");
    expect(evaluation.criticalGateFailures).toContain("revenue");
  });

  it("evaluates consecutive weekly readiness for the two-week evidence gate", () => {
    const readyNow = evaluateOutcomeGatesFromSummary({
      leadsSourced: 11,
      qualifiedLeads: 3,
      meetingsBooked: 2,
      depositsCollected: 1,
      pipelineValueUsd: 4000,
    });
    const readyPrior = evaluateOutcomeGatesFromSummary({
      leadsSourced: 8,
      qualifiedLeads: 2,
      meetingsBooked: 1,
      depositsCollected: 1,
      pipelineValueUsd: 2500,
    });
    const notReadyOlder = evaluateOutcomeGatesFromSummary({
      leadsSourced: 3,
      qualifiedLeads: 0,
      meetingsBooked: 0,
      depositsCollected: 0,
      pipelineValueUsd: 1000,
    });

    const readiness = summarizeConsecutiveOutcomeGateReadiness(
      [
        { weekStartDate: "2026-03-02", outcomeGates: readyNow },
        { weekStartDate: "2026-02-23", outcomeGates: readyPrior },
        { weekStartDate: "2026-02-16", outcomeGates: notReadyOlder },
      ],
      { minimumPassOrWarnGates: 3, targetConsecutiveWeeks: 2 }
    );

    expect(isOutcomeGateReady(readyNow, 3)).toBe(true);
    expect(isOutcomeGateReady(notReadyOlder, 3)).toBe(false);
    expect(readiness.consecutiveReadyWeeks).toBe(2);
    expect(readiness.meetsTarget).toBe(true);
    expect(readiness.weeks[0]?.weekStartDate).toBe("2026-03-02");
  });
});
