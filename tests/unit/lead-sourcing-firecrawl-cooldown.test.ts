import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadSourceProvider } from "@/lib/leads/providers/registry";

const enrichLeadsWithFirecrawlMock = vi.fn(async (leads: unknown[]) => leads);
const enrichLeadsWithBasicWebFetchMock = vi.fn(async (leads: unknown[]) => leads);

vi.mock("@/lib/leads/providers/firecrawl", () => ({
  enrichLeadsWithFirecrawl: enrichLeadsWithFirecrawlMock,
}));

vi.mock("@/lib/leads/providers/basic-web-enrichment", () => ({
  enrichLeadsWithBasicWebFetch: enrichLeadsWithBasicWebFetchMock,
}));

describe("sourceLeads firecrawl cooldown", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.FIRECRAWL_ENRICH_COOLDOWN_SEC = "900";
    process.env.LEAD_ENRICH_BASIC_FALLBACK_ENABLED = "true";
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
      (async (leads: unknown[], _key: string, options: { onQuotaExceeded?: () => void } = {}) => {
        options.onQuotaExceeded?.();
        return leads;
      }) as (leads: unknown[]) => Promise<unknown[]>
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
    expect(enrichLeadsWithBasicWebFetchMock).toHaveBeenCalledTimes(1);
    expect(first.warnings.some((warning) => warning.includes("Firecrawl quota exhausted"))).toBe(
      true
    );
    expect(first.warnings.some((warning) => warning.includes("Basic website enrichment fallback applied"))).toBe(true);

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
    expect(enrichLeadsWithBasicWebFetchMock).toHaveBeenCalledTimes(2);
    expect(
      second.warnings.some((warning) =>
        warning.includes("Firecrawl enrichment paused after quota exhaustion")
      )
    ).toBe(true);
    expect(second.warnings.some((warning) => warning.includes("firecrawl_cooldown_active"))).toBe(
      true
    );

    __resetFirecrawlEnrichmentCooldownForTests();
  });

  it("falls back to basic website fetch when Firecrawl key is missing", async () => {
    const provider: LeadSourceProvider = {
      source: "googlePlaces",
      run: vi.fn(async () => ({
        source: "googlePlaces" as const,
        leads: [
          {
            id: "lead-2",
            companyName: "Signal Two",
            website: "https://signal-two.example",
            source: "googlePlaces" as const,
            enriched: false,
          },
        ],
        warnings: [],
        pagesUsed: 1,
        estimatedCostUsd: 0.1,
      })),
    };

    vi.resetModules();
    vi.doMock("@/lib/leads/providers/registry", () => ({
      resolveLeadProviders: vi.fn(() => [provider]),
    }));

    const { __resetFirecrawlEnrichmentCooldownForTests, sourceLeads } = await import(
      "@/lib/leads/sourcing"
    );
    __resetFirecrawlEnrichmentCooldownForTests();

    const result = await sourceLeads(
      {
        query: "gallery",
        limit: 5,
        includeEnrichment: true,
      },
      {
        uid: "uid-firecrawl-missing-key",
        googlePlacesKey: "places-key",
      }
    );

    expect(enrichLeadsWithFirecrawlMock).not.toHaveBeenCalled();
    expect(enrichLeadsWithBasicWebFetchMock).toHaveBeenCalledTimes(1);
    expect(result.warnings.some((warning) => warning.includes("Firecrawl key missing"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("firecrawl_key_missing"))).toBe(true);

    __resetFirecrawlEnrichmentCooldownForTests();
  });
});
