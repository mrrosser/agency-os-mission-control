import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFER_DEFINITIONS } from "@/lib/revenue/offers";

interface KnowledgePackOffer {
  code?: string;
  depositRule?: string;
}

interface KnowledgePackBusiness {
  id?: string;
  packagedOffers?: KnowledgePackOffer[];
}

interface KnowledgePackRoot {
  businesses?: KnowledgePackBusiness[];
}

describe("knowledge-pack packaged offers", () => {
  it("keeps business profiles aligned with canonical offer deposit rules", () => {
    const knowledgePackPath = path.join(
      process.cwd(),
      "please-review",
      "from-root",
      "config-templates",
      "knowledge-pack.v2.json"
    );
    const parsed = JSON.parse(fs.readFileSync(knowledgePackPath, "utf8")) as KnowledgePackRoot;
    const businesses = Array.isArray(parsed.businesses) ? parsed.businesses : [];

    const byBusiness = new Map(
      businesses
        .map((business) => [String(business.id || ""), business] as const)
        .filter(([id]) => Boolean(id))
    );

    const canonical = OFFER_DEFINITIONS.reduce<Map<string, Map<string, string>>>((acc, offer) => {
      const businessOffers = acc.get(offer.businessUnit) || new Map<string, string>();
      businessOffers.set(offer.code, offer.depositRule);
      acc.set(offer.businessUnit, businessOffers);
      return acc;
    }, new Map<string, Map<string, string>>());

    for (const [businessUnit, expectedOffers] of canonical.entries()) {
      const profile = byBusiness.get(businessUnit);
      expect(profile, `missing business profile for ${businessUnit}`).toBeTruthy();

      const observedOffers = new Map<string, string>();
      for (const offer of profile?.packagedOffers || []) {
        const code = String(offer.code || "").trim();
        if (!code) continue;
        observedOffers.set(code, String(offer.depositRule || "").trim());
      }

      expect(
        observedOffers.size,
        `${businessUnit} offer count mismatch in knowledge pack`
      ).toBe(expectedOffers.size);

      for (const [offerCode, expectedDepositRule] of expectedOffers.entries()) {
        expect(
          observedOffers.get(offerCode),
          `${businessUnit} ${offerCode} deposit rule drift`
        ).toBe(expectedDepositRule);
      }
    }
  });
});
