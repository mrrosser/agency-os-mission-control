import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enrichLeadWithFirecrawl, enrichLeadsWithFirecrawl } from "@/lib/leads/providers/firecrawl";
import type { LeadCandidate } from "@/lib/leads/types";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("firecrawl enrichment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("extracts email + metadata from scraped markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: "Contact: sales@example.com and support@example.com",
            metadata: { title: "Acme", description: "Great products", keywords: "widgets,acme" },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    (globalThis as any).fetch = fetchMock;

    const lead: LeadCandidate = {
      id: "lead-1",
      companyName: "Acme Co",
      website: "https://acme.example",
      source: "googlePlaces",
      enriched: false,
    };

    const enriched = await enrichLeadWithFirecrawl(lead, "fc-test", log);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(enriched.email).toBe("sales@example.com");
    expect(enriched.websiteTitle).toBe("Acme");
    expect(enriched.websiteDescription).toBe("Great products");
    expect(enriched.websiteEmails).toEqual(["sales@example.com", "support@example.com"]);
    expect(enriched.enriched).toBe(true);
  });

  it("skips scraping when lead already has email", async () => {
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    const lead: LeadCandidate = {
      id: "lead-2",
      companyName: "Already Contactable",
      website: "https://example.com",
      email: "existing@example.com",
      source: "googlePlaces",
    };

    const enriched = await enrichLeadWithFirecrawl(lead, "fc-test", log);
    expect(enriched.email).toBe("existing@example.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enriches a bounded subset of leads and merges by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: "hello@acme.com",
            metadata: { title: "Acme" },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    (globalThis as any).fetch = fetchMock;

    const leads: LeadCandidate[] = [
      { id: "a", companyName: "A", website: "https://a.com", source: "googlePlaces" },
      { id: "b", companyName: "B", website: "https://b.com", source: "googlePlaces" },
      { id: "c", companyName: "C", website: "https://c.com", source: "googlePlaces" },
    ];

    const result = await enrichLeadsWithFirecrawl(leads, "fc-test", { maxLeads: 1, concurrency: 2 }, log);
    expect(result).toHaveLength(3);
    expect(result[0]?.email).toBe("hello@acme.com");
    expect(result[1]?.email).toBeUndefined();
    expect(result[2]?.email).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

