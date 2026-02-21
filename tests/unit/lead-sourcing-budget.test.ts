import { describe, it, expect, vi } from "vitest";
import type { LeadSourceProvider } from "@/lib/leads/providers/registry";

vi.mock("@/lib/leads/providers/firecrawl", () => ({
  enrichLeadsWithFirecrawl: vi.fn(async (leads: unknown[]) => leads),
}));

describe("sourceLeads budget guardrails", () => {
  it("hard-stops provider chain when page budget is reached", async () => {
    const providerA: LeadSourceProvider = {
      source: "googlePlaces",
      run: vi.fn(async () => ({
        source: "googlePlaces",
        leads: [
          {
            id: "lead-a",
            companyName: "Signal A",
            source: "googlePlaces",
            enriched: false,
          },
        ],
        warnings: [],
        pagesUsed: 3,
        estimatedCostUsd: 0.5,
      })),
    };
    const providerB: LeadSourceProvider = {
      source: "firestore",
      run: vi.fn(async () => ({
        source: "firestore",
        leads: [
          {
            id: "lead-b",
            companyName: "Signal B",
            source: "firestore",
            enriched: false,
          },
        ],
        warnings: [],
        pagesUsed: 1,
        estimatedCostUsd: 0,
      })),
    };

    vi.resetModules();
    vi.doMock("@/lib/leads/providers/registry", () => ({
      resolveLeadProviders: vi.fn(() => [providerA, providerB]),
    }));

    const { sourceLeads } = await import("@/lib/leads/sourcing");
    const result = await sourceLeads(
      {
        query: "hvac",
        limit: 10,
        includeEnrichment: false,
        budget: {
          maxPages: 3,
          maxRuntimeSec: 120,
          maxCostUsd: 10,
        },
      },
      {
        uid: "user-1",
        googlePlacesKey: "key",
      }
    );

    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]?.companyName).toBe("Signal A");
    expect(result.diagnostics?.budget.stopped).toBe(true);
    expect(result.diagnostics?.budget.stopReason).toBe("page_limit");
    expect(result.warnings.some((warning) => warning.includes("Budget guardrail"))).toBe(true);
    const providerBRun = providerB.run as unknown as ReturnType<typeof vi.fn>;
    expect(providerBRun).not.toHaveBeenCalled();
  });
});
