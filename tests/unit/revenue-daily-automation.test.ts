import { describe, expect, it } from "vitest";
import {
  normalizeRevenueAutomationStages,
  resolveRevenueAutomationStage,
  templateIdForRevenueBusiness,
} from "@/lib/revenue/daily-automation";

describe("revenue daily automation helpers", () => {
  it("normalizes and dedupes requested stages", () => {
    expect(normalizeRevenueAutomationStages(["day2", "day1", "day2", "bad"])).toEqual([
      "day2",
      "day1",
    ]);
  });

  it("resolves the highest requested stage", () => {
    expect(resolveRevenueAutomationStage(["day1", "day2"])).toBe("day2");
    expect(resolveRevenueAutomationStage(["day1", "day30"])).toBe("day30");
    expect(resolveRevenueAutomationStage(undefined)).toBe("day1");
  });

  it("maps business keys to canonical template ids", () => {
    expect(templateIdForRevenueBusiness("rng")).toBe("rng-south-day1");
    expect(templateIdForRevenueBusiness("rts")).toBe("rts-south-day1");
    expect(templateIdForRevenueBusiness("aicf")).toBe("aicf-south-day1");
  });
});
