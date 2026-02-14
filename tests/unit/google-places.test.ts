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

  it("enriches leads with phone, website, and Google Maps URL when enabled", async () => {
    mockFetch
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        json: async () => ({
          status: "OK",
          result: {
            formatted_phone_number: "(512) 555-0100",
            website: "https://signal.example",
            url: "https://maps.google.com/?cid=123",
            business_status: "OPERATIONAL",
            photos: [
              {
                photo_reference: "photo-ref-1",
                width: 1024,
                height: 768,
                html_attributions: ["<a href=\"https://maps.google.com/maps/contrib/1\">Photo Author</a>"],
              },
            ],
            opening_hours: { open_now: true, weekday_text: ["Mon: 9-5"] },
            price_level: 2,
            geometry: { location: { lat: 30.2672, lng: -97.7431 } },
          },
        }),
      });

    const leads = await fetchGooglePlacesLeads({
      apiKey: "test-key",
      query: "HVAC contractors",
      location: "Austin, TX",
      limit: 5,
      includeEnrichment: true,
    });

    expect(leads).toHaveLength(1);
    expect(leads[0]?.phone).toBe("(512) 555-0100");
    expect(leads[0]?.website).toBe("https://signal.example");
    expect(leads[0]?.googleMapsUrl).toBe("https://maps.google.com/?cid=123");
    expect(leads[0]?.businessStatus).toBe("OPERATIONAL");
    expect(leads[0]?.openNow).toBe(true);
    expect(leads[0]?.openingHours).toEqual(["Mon: 9-5"]);
    expect(leads[0]?.priceLevel).toBe(2);
    expect(leads[0]?.lat).toBe(30.2672);
    expect(leads[0]?.lng).toBe(-97.7431);
    expect(leads[0]?.placePhotos).toEqual([
      {
        ref: "photo-ref-1",
        width: 1024,
        height: 768,
        htmlAttributions: ["<a href=\"https://maps.google.com/maps/contrib/1\">Photo Author</a>"],
      },
    ]);
    expect(leads[0]?.enriched).toBe(true);
  });
});
