import { describe, expect, it } from "vitest";
import { resolveOfferCodeForBusinessUnit } from "@/lib/revenue/offers";

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
});

