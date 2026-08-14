import { describe, expect, it } from "vitest";
import {
  BUSINESS_UNIT_OPTIONS,
  findOfferByCode,
  normalizeBusinessUnit,
  resolveOfferCodeForBusinessUnit,
} from "@/lib/revenue/offers";

describe("revenue offer normalization", () => {
  it("keeps a valid offer code for the selected business unit", () => {
    const result = resolveOfferCodeForBusinessUnit("rt_solutions", "RTS-AI-LUNCH-LEARN");
    expect(result.offerCode).toBe("RTS-AI-LUNCH-LEARN");
    expect(result.adjusted).toBe(false);
    expect(result.requestedCode).toBe("RTS-AI-LUNCH-LEARN");
  });

  it("falls back to the business default when offer code belongs to another business", () => {
    const result = resolveOfferCodeForBusinessUnit("rt_solutions", "RNG-COMMISSION-SCULPTURE");
    expect(result.offerCode).toBe("RTS-QUICK-WEBSITE-SPRINT");
    expect(result.adjusted).toBe(true);
    expect(result.requestedCode).toBe("RNG-COMMISSION-SCULPTURE");
  });

  it("keeps retired identifiers readable but off active business options", () => {
    expect(BUSINESS_UNIT_OPTIONS.map((option) => option.id)).toEqual([
      "rosser_nft_gallery",
      "rt_solutions",
    ]);
    expect(normalizeBusinessUnit("aicf")).toBe("ai_cofoundry");
    expect(findOfferByCode("AICF-DISCOVERY")).toMatchObject({
      businessUnit: "ai_cofoundry",
      code: "AICF-DISCOVERY",
    });
  });

  it("rejects unknown non-empty business identifiers", () => {
    expect(() => normalizeBusinessUnit("unknown-business")).toThrow(
      "Unsupported business unit 'unknown-business'"
    );
  });
});

