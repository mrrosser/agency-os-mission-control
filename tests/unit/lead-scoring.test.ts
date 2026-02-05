import { describe, it, expect } from "vitest";
import { scoreLead } from "@/lib/leads/scoring";
import type { LeadCandidate } from "@/lib/leads/types";

describe("scoreLead", () => {
  it("boosts score for industry + keyword matches", () => {
    const candidate: LeadCandidate = {
      id: "1",
      companyName: "Atlas HVAC Services",
      industry: "HVAC contractors",
      location: "Austin, TX",
      rating: 4.6,
      reviewCount: 120,
      source: "googlePlaces",
      website: "https://atlashvac.com",
      phone: "+15125551212",
    };

    const { score, signals } = scoreLead(candidate, {
      targetIndustry: "HVAC",
      keywords: ["contractors", "Austin"],
      location: "Austin",
    });

    expect(signals.industryMatch).toBe(true);
    expect(signals.keywordMatch).toBe(true);
    expect(signals.locationMatch).toBe(true);
    expect(score).toBeGreaterThan(60);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("stays within 0-100 bounds", () => {
    const candidate: LeadCandidate = {
      id: "2",
      companyName: "Unknown",
      source: "firestore",
    };

    const { score } = scoreLead(candidate, {});
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
