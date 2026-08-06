import { describe, expect, it } from "vitest";
import {
  describeRevenueAutomationError,
  normalizeDay2TemplateIds,
} from "@/lib/revenue/day2-automation";

describe("normalizeDay2TemplateIds", () => {
  it("dedupes, trims, and drops invalid ids", () => {
    const veryLong = "x".repeat(121);
    const result = normalizeDay2TemplateIds([
      " rng-south-day1 ",
      "rng-south-day1",
      "",
      "   ",
      "rts-south-day1",
      veryLong,
      "aicf-south-day1",
    ]);

    expect(result).toEqual(["rng-south-day1", "rts-south-day1", "aicf-south-day1"]);
  });

  it("returns empty array for nullish input", () => {
    expect(normalizeDay2TemplateIds(undefined)).toEqual([]);
    expect(normalizeDay2TemplateIds(null)).toEqual([]);
  });

  it("preserves useful details from structured provider errors", () => {
    expect(
      describeRevenueAutomationError({ code: 7, details: "Secret access denied" }),
    ).toBe("7: Secret access denied");
    expect(describeRevenueAutomationError({ code: "NOT_FOUND" })).toBe(
      "Error code NOT_FOUND",
    );
    expect(describeRevenueAutomationError({})).toBe("Unknown structured error");

    const deployedFailure = Object.assign(
      new Error("undefined undefined: undefined"),
      { code: 5, details: "Secret version was not found" },
    );
    expect(describeRevenueAutomationError(deployedFailure)).toBe(
      "5: Secret version was not found",
    );
  });
});
