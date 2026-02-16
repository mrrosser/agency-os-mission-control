import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enrichLeadWithFirecrawl, enrichLeadsWithFirecrawl } from "@/lib/leads/providers/firecrawl";
import type { LeadCandidate } from "@/lib/leads/types";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function firecrawlOk(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("firecrawl enrichment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("extracts email + metadata from scraped markdown", async () => {
    const fetchMock = vi.fn(async () =>
      firecrawlOk({
        markdown: "Contact: sales@example.com and support@example.com. Call (512) 555-0100.",
        links: ["https://www.linkedin.com/company/acme"],
        metadata: { title: "Acme", description: "Great products", keywords: "widgets,acme" },
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

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
    expect(enriched.phone).toBe("5125550100");
    expect(enriched.phones).toEqual(["5125550100"]);
    expect(enriched.websiteDomain).toBe("acme.example");
    expect(enriched.socialLinks).toEqual({ linkedin: "https://www.linkedin.com/company/acme" });
    expect(enriched.websiteTitle).toBe("Acme");
    expect(enriched.websiteDescription).toBe("Great products");
    expect(enriched.websiteEmails).toEqual(["sales@example.com", "support@example.com"]);
    expect(enriched.enriched).toBe(true);
  });

  it("skips scraping when lead already has contact + metadata signals", async () => {
    const fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const lead: LeadCandidate = {
      id: "lead-2",
      companyName: "Already Contactable",
      website: "https://example.com",
      email: "existing@example.com",
      phone: "+15125550100",
      socialLinks: { linkedin: "https://linkedin.com/company/example" },
      websiteTitle: "Example",
      websiteDescription: "Existing metadata",
      source: "googlePlaces",
    };

    const enriched = await enrichLeadWithFirecrawl(lead, "fc-test", log);
    expect(enriched.email).toBe("existing@example.com");
    expect(enriched.phone).toBe("+15125550100");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enriches missing phone/socials even when lead already has email", async () => {
    const fetchMock = vi.fn(async () =>
      firecrawlOk({
        markdown: "Contact us at hello@example.com or call +1 (555) 444-9999",
        links: ["https://linkedin.com/company/example-co"],
        metadata: { title: "Example Co", description: "Boutique studio" },
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const lead: LeadCandidate = {
      id: "lead-2b",
      companyName: "Existing Email Lead",
      website: "https://example-co.com",
      email: "owner@example-co.com",
      source: "googlePlaces",
    };

    const enriched = await enrichLeadWithFirecrawl(lead, "fc-test", log);
    expect(enriched.email).toBe("owner@example-co.com");
    expect(enriched.phone).toBe("+15554449999");
    expect(enriched.socialLinks?.linkedin).toBe("https://linkedin.com/company/example-co");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enriches a bounded subset of leads and merges by id", async () => {
    const fetchMock = vi.fn(async () =>
      firecrawlOk({
        markdown: "hello@acme.com",
        metadata: { title: "Acme" },
      })
    );
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
