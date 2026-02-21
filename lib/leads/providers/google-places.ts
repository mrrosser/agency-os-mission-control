import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";

interface GooglePlacesSearchParams {
  apiKey: string;
  query: string;
  location?: string;
  limit: number;
  includeEnrichment?: boolean;
  maxPages?: number;
  maxRuntimeSec?: number;
  log?: Logger;
}

interface GooglePlacesTextSearchResponse {
  status: string;
  error_message?: string;
  next_page_token?: string;
  results: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
  }>;
}

interface GooglePlacesDetailsResponse {
  status: string;
  error_message?: string;
  result?: {
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    url?: string;
    business_status?: string;
    photos?: Array<{
      photo_reference?: string;
      width?: number;
      height?: number;
      html_attributions?: string[];
    }>;
    opening_hours?: {
      open_now?: boolean;
      weekday_text?: string[];
    };
    price_level?: number;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
}

export interface GooglePlacesFetchResult {
  leads: LeadCandidate[];
  pagesFetched: number;
  detailsFetched: number;
  estimatedCostUsd: number;
  stopReason?: "page_limit" | "runtime_limit" | "no_more_results";
}

const ESTIMATED_TEXT_SEARCH_PAGE_COST_USD = Number.parseFloat(
  process.env.GOOGLE_PLACES_TEXT_SEARCH_COST_USD || "0.017"
);
const ESTIMATED_DETAILS_CALL_COST_USD = Number.parseFloat(
  process.env.GOOGLE_PLACES_DETAILS_COST_USD || "0.017"
);
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_MAX_RUNTIME_SEC = 40;

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQuery(query: string, location?: string) {
  const trimmed = query.trim();
  // Long "ICP" descriptions degrade Places search; cap to a reasonable prefix.
  const cappedBase = trimmed.split(/\s+/).slice(0, 12).join(" ").slice(0, 120).trim();
  if (!location) return cappedBase;
  const combined = `${cappedBase} in ${location.trim()}`;
  return combined.length > 160 ? combined.slice(0, 160).trimEnd() : combined;
}

async function fetchTextSearchPage(args: {
  apiKey: string;
  query: string;
  pageToken?: string;
  timeoutMs: number;
}): Promise<GooglePlacesTextSearchResponse> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  if (args.pageToken) {
    url.searchParams.set("pagetoken", args.pageToken);
  } else {
    url.searchParams.set("query", args.query);
  }
  url.searchParams.set("key", args.apiKey);

  const { controller, timeout } = withTimeout(args.timeoutMs);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    return (await response.json()) as GooglePlacesTextSearchResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGooglePlacesLeads(
  params: GooglePlacesSearchParams
): Promise<GooglePlacesFetchResult> {
  const { apiKey, query, location, limit, includeEnrichment, log } = params;
  const maxPages = Math.min(Math.max(params.maxPages || DEFAULT_MAX_PAGES, 1), 10);
  const maxRuntimeMs =
    Math.min(Math.max(params.maxRuntimeSec || DEFAULT_MAX_RUNTIME_SEC, 5), 120) * 1000;
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + maxRuntimeMs;
  const searchQuery = buildQuery(query, location);

  log?.info("lead.source.google_places.requested", {
    query: searchQuery,
    location: location || null,
    limit,
    includeEnrichment: Boolean(includeEnrichment),
    maxPages,
    maxRuntimeSec: Math.floor(maxRuntimeMs / 1000),
  });

  const candidates: LeadCandidate[] = [];
  let pagesFetched = 0;
  let nextPageToken: string | undefined;
  let stopReason: GooglePlacesFetchResult["stopReason"] = "no_more_results";

  while (candidates.length < limit && pagesFetched < maxPages) {
    if (Date.now() >= deadlineMs) {
      stopReason = "runtime_limit";
      break;
    }

    if (nextPageToken) {
      // Google may take a moment before next_page_token becomes valid.
      await sleep(1800);
    }

    const payload = await fetchTextSearchPage({
      apiKey,
      query: searchQuery,
      pageToken: nextPageToken,
      timeoutMs: 10_000,
    });

    if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
      log?.warn("lead.source.google_places.failed", {
        status: payload.status,
        error: payload.error_message || "unknown",
      });
      throw new Error(payload.error_message || "Google Places search failed");
    }

    pagesFetched += 1;
    if (!payload.results?.length) {
      stopReason = "no_more_results";
      break;
    }

    for (const result of payload.results) {
      if (candidates.length >= limit) break;
      candidates.push({
        id: result.place_id,
        companyName: result.name,
        location: result.formatted_address,
        industry: result.types?.join(", "),
        rating: result.rating,
        reviewCount: result.user_ratings_total,
        source: "googlePlaces",
        enriched: false,
      });
    }

    nextPageToken = payload.next_page_token;
    if (!nextPageToken) {
      stopReason = "no_more_results";
      break;
    }
  }

  if (pagesFetched >= maxPages && nextPageToken && candidates.length < limit) {
    stopReason = "page_limit";
  } else if (!stopReason) {
    stopReason = "no_more_results";
  }

  if (!includeEnrichment || candidates.length === 0 || Date.now() >= deadlineMs) {
    const estimatedCostUsd =
      pagesFetched * ESTIMATED_TEXT_SEARCH_PAGE_COST_USD;
    return {
      leads: candidates,
      pagesFetched,
      detailsFetched: 0,
      estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : 0,
      stopReason,
    };
  }

  const enriched = await Promise.all(
    candidates.map(async (candidate) => {
      if (Date.now() >= deadlineMs) {
        return candidate;
      }

      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", candidate.id);
      detailsUrl.searchParams.set(
        "fields",
        [
          "formatted_phone_number",
          "international_phone_number",
          "website",
          "url",
          "business_status",
          "photos",
          "opening_hours",
          "price_level",
          "geometry",
        ].join(",")
      );
      detailsUrl.searchParams.set("key", apiKey);

      const timeoutControl = withTimeout(8000);
      try {
        const response = await fetch(detailsUrl.toString(), {
          signal: timeoutControl.controller.signal,
        });
        const details = (await response.json()) as GooglePlacesDetailsResponse;
        if (details.status !== "OK") {
          return candidate;
        }

        const lat = details.result?.geometry?.location?.lat;
        const lng = details.result?.geometry?.location?.lng;
        const placePhotos = (details.result?.photos || [])
          .map((photo) => {
            const ref = (photo.photo_reference || "").trim();
            const width = typeof photo.width === "number" ? photo.width : null;
            const height = typeof photo.height === "number" ? photo.height : null;
            if (!ref || !width || !height) return null;
            return {
              ref,
              width,
              height,
              htmlAttributions: Array.isArray(photo.html_attributions)
                ? photo.html_attributions.filter((v) => typeof v === "string").slice(0, 4)
                : undefined,
            };
          })
          .filter(
            (
              photo
            ): photo is {
              ref: string;
              width: number;
              height: number;
              htmlAttributions: string[] | undefined;
            } => Boolean(photo)
          )
          .slice(0, 3);

        return {
          ...candidate,
          phone:
            details.result?.international_phone_number ||
            details.result?.formatted_phone_number,
          website: details.result?.website,
          googleMapsUrl: details.result?.url,
          placePhotos: placePhotos.length > 0 ? placePhotos : undefined,
          businessStatus: details.result?.business_status,
          openNow: details.result?.opening_hours?.open_now,
          openingHours: details.result?.opening_hours?.weekday_text,
          priceLevel: details.result?.price_level,
          lat: typeof lat === "number" ? lat : undefined,
          lng: typeof lng === "number" ? lng : undefined,
          enriched: true,
        };
      } catch (error) {
        log?.warn("lead.source.google_places.enrichment_failed", {
          leadId: candidate.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        return candidate;
      } finally {
        clearTimeout(timeoutControl.timeout);
      }
    })
  );

  const detailsFetched = enriched.filter((lead) => lead.enriched).length;
  const estimatedCostUsd =
    pagesFetched * ESTIMATED_TEXT_SEARCH_PAGE_COST_USD +
    detailsFetched * ESTIMATED_DETAILS_CALL_COST_USD;

  return {
    leads: enriched,
    pagesFetched,
    detailsFetched,
    estimatedCostUsd: Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : 0,
    stopReason,
  };
}
