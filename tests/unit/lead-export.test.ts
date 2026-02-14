import { describe, expect, it } from "vitest";
import { leadsToCsv } from "@/lib/leads/export";

describe("leadsToCsv", () => {
  it("renders a stable CSV with escaped values", () => {
    const csv = leadsToCsv([
      {
        companyName: 'Acme, Inc.',
        website: "https://acme.example",
        websiteDomain: "acme.example",
        googleMapsUrl: "https://maps.google.com/?cid=123",
        email: "sales@acme.example",
        phone: "+15125550100",
        phones: ["+15125550100", "+15125550101"],
        location: "Austin, TX",
        industry: "hvac_contractor",
        rating: 4.7,
        reviewCount: 98,
        businessStatus: "OPERATIONAL",
        openNow: true,
        priceLevel: 2,
        socialLinks: { linkedin: "https://linkedin.com/company/acme" },
        score: 77,
        source: "googlePlaces",
      },
    ]);

    expect(csv).toContain("companyName,website,websiteDomain");
    expect(csv).toContain('"Acme, Inc.",https://acme.example,acme.example');
    expect(csv).toContain("phones");
    expect(csv).toContain("socialLinks");
    expect(csv).toContain("linkedin:https://linkedin.com/company/acme");
    expect(csv).toContain("4.7");
  });
});

