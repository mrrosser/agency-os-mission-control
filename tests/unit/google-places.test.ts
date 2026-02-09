import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGooglePlacesLeads } from "@/lib/leads/providers/google-places";

const mockFetch = vi.fn();

describe("fetchGooglePlacesLeads", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Google Places results into lead candidates", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({
        status: "OK",
        results: [
          {
            place_id: "place-1",
            name: "Signal HVAC",
            formatted_address: "Austin, TX",
            rating: 4.7,
            user_ratings_total: 98,
            types: ["hvac_contractor"],
          },
        ],
      }),
    });

    const leads = await fetchGooglePlacesLeads({
      apiKey: "test-key",
      query: "HVAC contractors",
      location: "Austin, TX",
      limit: 5,
      includeEnrichment: false,
    });

    expect(leads).toHaveLength(1);
    expect(leads[0]?.companyName).toBe("Signal HVAC");
    expect(leads[0]?.rating).toBe(4.7);
    expect(leads[0]?.reviewCount).toBe(98);
  });
});
