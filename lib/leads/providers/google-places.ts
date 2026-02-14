import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";

interface GooglePlacesSearchParams {
    apiKey: string;
    query: string;
    location?: string;
    limit: number;
    includeEnrichment?: boolean;
    log?: Logger;
}

interface GooglePlacesTextSearchResponse {
    status: string;
    error_message?: string;
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

function withTimeout(timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return { controller, timeout };
}

function buildQuery(query: string, location?: string) {
    const trimmed = query.trim();
    if (!location) return trimmed;
    return `${trimmed} in ${location.trim()}`;
}

export async function fetchGooglePlacesLeads(params: GooglePlacesSearchParams): Promise<LeadCandidate[]> {
    const { apiKey, query, location, limit, includeEnrichment, log } = params;
    const searchQuery = buildQuery(query, location);
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", searchQuery);
    url.searchParams.set("key", apiKey);

    log?.info("lead.source.google_places.requested", {
        query: searchQuery,
        location: location || null,
        limit,
        includeEnrichment: Boolean(includeEnrichment),
    });

    const { controller, timeout } = withTimeout(10000);
    let payload: GooglePlacesTextSearchResponse;
    try {
        const response = await fetch(url.toString(), { signal: controller.signal });
        payload = (await response.json()) as GooglePlacesTextSearchResponse;
    } finally {
        clearTimeout(timeout);
    }

    if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
        log?.warn("lead.source.google_places.failed", {
            status: payload.status,
            error: payload.error_message || "unknown",
        });
        throw new Error(payload.error_message || "Google Places search failed");
    }

    const candidates = payload.results.slice(0, limit).map((result) => ({
        id: result.place_id,
        companyName: result.name,
        location: result.formatted_address,
        industry: result.types?.join(", "),
        rating: result.rating,
        reviewCount: result.user_ratings_total,
        source: "googlePlaces" as const,
        enriched: false,
    }));

    if (!includeEnrichment || candidates.length === 0) {
        return candidates;
    }

    const enriched = await Promise.all(
        candidates.map(async (candidate) => {
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
                    phone: details.result?.international_phone_number || details.result?.formatted_phone_number,
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

    return enriched;
}
