import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadSourceProvider } from "@/lib/leads/providers/registry";

const enrichLeadsWithFirecrawlMock = vi.fn(async (leads: unknown[]) => leads);

vi.mock("@/lib/leads/providers/firecrawl", () => ({
  enrichLeadsWithFirecrawl: enrichLeadsWithFirecrawlMock,
}));

describe("sourceLeads firecrawl cooldown", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.FIRECRAWL_ENRICH_COOLDOWN_SEC = "900";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sets cooldown after quota exhaustion and skips subsequent enrichment calls", async () => {
    const provider: LeadSourceProvider = {
      source: "googlePlaces",
      run: vi.fn(async () => ({
        source: "googlePlaces" as const,
        leads: [
          {
            id: "lead-1",
            companyName: "Signal One",
            website: "https://signal-one.example",
            source: "googlePlaces" as const,
            enriched: false,
          },
        ],
        warnings: [],
        pagesUsed: 1,
        estimatedCostUsd: 0.2,
      })),
    };

    vi.resetModules();
    vi.doMock("@/lib/leads/providers/registry", () => ({
      resolveLeadProviders: vi.fn(() => [provider]),
    }));

    enrichLeadsWithFirecrawlMock.mockImplementationOnce(
      async (leads: unknown[], _key: string, options: { onQuotaExceeded?: () => void } = {}) => {
        options.onQuotaExceeded?.();
        return leads;
      }
    );

    const { __resetFirecrawlEnrichmentCooldownForTests, sourceLeads } = await import(
      "@/lib/leads/sourcing"
    );
    __resetFirecrawlEnrichmentCooldownForTests();

    const first = await sourceLeads(
      {
        query: "gallery",
        limit: 5,
        includeEnrichment: true,
      },
      {
        uid: "uid-firecrawl-cooldown",
        googlePlacesKey: "places-key",
        firecrawlKey: "firecrawl-key",
      }
    );

    expect(enrichLeadsWithFirecrawlMock).toHaveBeenCalledTimes(1);
    expect(first.warnings.some((warning) => warning.includes("Firecrawl quota exhausted"))).toBe(
      true
    );

    const second = await sourceLeads(
      {
        query: "gallery",
        limit: 5,
        includeEnrichment: true,
      },
      {
        uid: "uid-firecrawl-cooldown",
        googlePlacesKey: "places-key",
        firecrawlKey: "firecrawl-key",
      }
    );

    expect(enrichLeadsWithFirecrawlMock).toHaveBeenCalledTimes(1);
    expect(
      second.warnings.some((warning) =>
        warning.includes("Firecrawl enrichment paused after quota exhaustion")
      )
    ).toBe(true);

    __resetFirecrawlEnrichmentCooldownForTests();
  });
});
