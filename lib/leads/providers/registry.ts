import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate, LeadSource, LeadSourceRequest } from "@/lib/leads/types";
import { fetchFirestoreLeads } from "@/lib/leads/providers/firestore";
import {
  fetchGooglePlacesLeads,
  type GooglePlacesFetchResult,
} from "@/lib/leads/providers/google-places";
import { fetchApifyMapsLeads } from "@/lib/leads/providers/apify-maps";

export interface LeadProviderBudgetWindow {
  remainingPages: number;
  remainingRuntimeSec: number;
}

export interface LeadProviderArgs {
  request: LeadSourceRequest;
  uid: string;
  googlePlacesKey?: string;
  apifyToken?: string;
  budget: LeadProviderBudgetWindow;
  log?: Logger;
}

export interface LeadProviderResult {
  source: LeadSource;
  leads: LeadCandidate[];
  warnings: string[];
  pagesUsed: number;
  estimatedCostUsd: number;
}

export type LeadSourceProvider = {
  source: LeadSource;
  run: (args: LeadProviderArgs) => Promise<LeadProviderResult>;
};

function googleResultWarnings(result: GooglePlacesFetchResult): string[] {
  if (result.stopReason === "page_limit") {
    return [
      `Google Places pagination stopped at ${result.pagesFetched} page(s) due to max page budget.`,
    ];
  }
  if (result.stopReason === "runtime_limit") {
    return ["Google Places pagination stopped due to runtime budget."];
  }
  return [];
}

const googlePlacesProvider: LeadSourceProvider = {
  source: "googlePlaces",
  run: async (args) => {
    if (!args.googlePlacesKey) {
      return {
        source: "googlePlaces",
        leads: [],
        warnings: ["Google Places key missing; skipping Google Places sourcing."],
        pagesUsed: 0,
        estimatedCostUsd: 0,
      };
    }

    const query = args.request.query || args.request.industry || "business";
    const result = await fetchGooglePlacesLeads({
      apiKey: args.googlePlacesKey,
      query,
      location: args.request.location,
      limit: args.request.limit || 10,
      includeEnrichment: args.request.includeEnrichment,
      maxPages: Math.max(1, args.budget.remainingPages),
      maxRuntimeSec: Math.max(5, args.budget.remainingRuntimeSec),
      log: args.log,
    });

    return {
      source: "googlePlaces",
      leads: result.leads,
      warnings: googleResultWarnings(result),
      pagesUsed: result.pagesFetched,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  },
};

const firestoreProvider: LeadSourceProvider = {
  source: "firestore",
  run: async (args) => {
    const leads = await fetchFirestoreLeads({
      uid: args.uid,
      limit: args.request.limit || 10,
      log: args.log,
    });

    return {
      source: "firestore",
      leads,
      warnings: [],
      pagesUsed: 0,
      estimatedCostUsd: 0,
    };
  },
};

const apifyMapsProvider: LeadSourceProvider = {
  source: "apifyMaps",
  run: async (args) => {
    const token = (args.apifyToken || "").trim();
    if (!token) {
      return {
        source: "apifyMaps",
        leads: [],
        warnings: ["Apify token missing; skipping Apify Maps sourcing."],
        pagesUsed: 0,
        estimatedCostUsd: 0,
      };
    }

    const actorId = (process.env.APIFY_GOOGLE_MAPS_ACTOR_ID || "").trim();
    const result = await fetchApifyMapsLeads({
      token,
      actorId,
      query: args.request.query || args.request.industry || "business",
      location: args.request.location,
      limit: args.request.limit || 10,
      maxRuntimeSec: Math.max(5, args.budget.remainingRuntimeSec),
      log: args.log,
    });

    return {
      source: "apifyMaps",
      leads: result.leads,
      warnings: [],
      pagesUsed: result.pagesFetched,
      estimatedCostUsd: result.estimatedCostUsd,
    };
  },
};

const PROVIDERS: Record<LeadSource, LeadSourceProvider> = {
  googlePlaces: googlePlacesProvider,
  firestore: firestoreProvider,
  apifyMaps: apifyMapsProvider,
};

export function resolveLeadProviders(sources: LeadSource[]): LeadSourceProvider[] {
  return sources
    .map((source) => PROVIDERS[source])
    .filter((provider): provider is LeadSourceProvider => Boolean(provider));
}
