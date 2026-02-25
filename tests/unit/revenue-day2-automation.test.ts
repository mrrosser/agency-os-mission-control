import { describe, expect, it } from "vitest";
import { normalizeDay2TemplateIds } from "@/lib/revenue/day2-automation";

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
});
