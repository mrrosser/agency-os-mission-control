import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";

interface ApifyMapsParams {
  token: string;
  actorId: string;
  query: string;
  location?: string;
  limit: number;
  maxRuntimeSec?: number;
  log?: Logger;
}

interface ApifyMapsFetchResult {
  leads: LeadCandidate[];
  pagesFetched: number;
  estimatedCostUsd: number;
}

const DEFAULT_ACTOR_ID = "compass/google-maps-scraper";
const DEFAULT_MAX_RUNTIME_SEC = 45;
const APIFY_EST_COST_PER_1K_RESULTS_USD = Number.parseFloat(
  process.env.APIFY_EST_COST_PER_1K_RESULTS_USD || "0.4"
);

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function mapItemToLead(item: Record<string, unknown>, index: number): LeadCandidate | null {
  const companyName = firstString([
    item.title,
    item.name,
    item.companyName,
    item.businessName,
  ]);
  if (!companyName) return null;

  const id =
    firstString([item.placeId, item.place_id, item.cid, item.id]) ||
    `apify-maps-${index + 1}`;

  const categories =
    Array.isArray(item.categoryName)
      ? item.categoryName.filter((entry): entry is string => typeof entry === "string")
      : Array.isArray(item.categories)
        ? item.categories.filter((entry): entry is string => typeof entry === "string")
        : [];

  const lat =
    numberOrUndefined(item.latitude) ??
    numberOrUndefined(item.lat) ??
    numberOrUndefined((item.location as Record<string, unknown> | undefined)?.lat);
  const lng =
    numberOrUndefined(item.longitude) ??
    numberOrUndefined(item.lng) ??
    numberOrUndefined((item.location as Record<string, unknown> | undefined)?.lng);

  const rating =
    numberOrUndefined(item.totalScore) ?? numberOrUndefined(item.rating);
  const reviewCount =
    numberOrUndefined(item.reviewsCount) ??
    numberOrUndefined(item.reviews) ??
    numberOrUndefined(item.reviewCount);

  const website = firstString([
    item.website,
    item.websiteUrl,
    item.domain,
  ]);

  return {
    id,
    companyName,
    location: firstString([
      item.address,
      item.fullAddress,
      item.street,
      (item.location as Record<string, unknown> | undefined)?.address,
    ]),
    industry: categories.length > 0 ? categories.join(", ") : undefined,
    phone: firstString([item.phone, item.phoneUnformatted]),
    website,
    googleMapsUrl: firstString([item.url, item.googleMapsUrl, item.placeUrl]),
    rating,
    reviewCount,
    lat,
    lng,
    source: "apifyMaps",
    enriched: Boolean(website),
  };
}

export async function fetchApifyMapsLeads(
  params: ApifyMapsParams
): Promise<ApifyMapsFetchResult> {
  const token = params.token.trim();
  const actorId = (params.actorId || DEFAULT_ACTOR_ID).trim();
  const maxRuntimeSec = Math.min(
    Math.max(params.maxRuntimeSec || DEFAULT_MAX_RUNTIME_SEC, 10),
    120
  );
  const searchText = [params.query.trim(), params.location?.trim()]
    .filter(Boolean)
    .join(" in ");

  params.log?.info("lead.source.apify_maps.requested", {
    actorId,
    limit: params.limit,
    maxRuntimeSec,
    query: searchText,
  });

  const url = new URL(
    `https://api.apify.com/v2/acts/${encodeURIComponent(
      actorId
    )}/run-sync-get-dataset-items`
  );
  url.searchParams.set("token", token);
  url.searchParams.set("timeout", `${maxRuntimeSec}`);

  const payload = {
    searchStringsArray: [searchText || "business"],
    maxCrawledPlaces: Math.max(1, Math.min(params.limit, 50)),
    scrapePlaceDetail: true,
    maxImages: 0,
    maxReviews: 0,
    language: "en",
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify Maps request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const dataset = (await response.json()) as unknown;
  const items = Array.isArray(dataset) ? dataset : [];
  const leads = items
    .map((item, index) =>
      item && typeof item === "object"
        ? mapItemToLead(item as Record<string, unknown>, index)
        : null
    )
    .filter((lead): lead is LeadCandidate => Boolean(lead))
    .slice(0, params.limit);

  const estimatedCostUsd = Math.max(
    0,
    Number.isFinite(APIFY_EST_COST_PER_1K_RESULTS_USD)
      ? (leads.length / 1000) * APIFY_EST_COST_PER_1K_RESULTS_USD
      : 0
  );

  params.log?.info("lead.source.apify_maps.completed", {
    actorId,
    returned: leads.length,
    estimatedCostUsd,
  });

  return {
    leads,
    pagesFetched: 1,
    estimatedCostUsd,
  };
}
