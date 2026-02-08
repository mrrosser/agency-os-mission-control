import type { Logger } from "@/lib/logging";
import type { LeadCandidate, LeadScoringCriteria, LeadSource, LeadSourceRequest } from "@/lib/leads/types";
import { scoreLead } from "@/lib/leads/scoring";
import { fetchGooglePlacesLeads } from "@/lib/leads/providers/google-places";
import { fetchFirestoreLeads } from "@/lib/leads/providers/firestore";
import { enrichLeadsWithFirecrawl } from "@/lib/leads/providers/firecrawl";

interface SourceContext {
    uid: string;
    googlePlacesKey?: string;
    firecrawlKey?: string;
    log?: Logger;
}

interface SourceResult {
    leads: LeadCandidate[];
    sourcesUsed: LeadSource[];
    warnings: string[];
}

export async function sourceLeads(
    request: LeadSourceRequest,
    context: SourceContext
): Promise<SourceResult> {
    const { uid, googlePlacesKey, firecrawlKey, log } = context;
    const warnings: string[] = [];
    const sourcesRequested = request.sources ?? [];
    const includeGooglePlaces = sourcesRequested.includes("googlePlaces") || sourcesRequested.length === 0;
    const includeFirestore = sourcesRequested.includes("firestore") || sourcesRequested.length === 0;

    const leads: LeadCandidate[] = [];
    const sourcesUsed: LeadSource[] = [];

    if (includeGooglePlaces) {
        if (!googlePlacesKey) {
            warnings.push("Google Places key missing; skipping Google Places sourcing.");
        } else {
            const query = request.query || request.industry || "business";
            const googleLeads = await fetchGooglePlacesLeads({
                apiKey: googlePlacesKey,
                query,
                location: request.location,
                limit: request.limit || 10,
                includeEnrichment: request.includeEnrichment,
                log,
            });
            leads.push(...googleLeads);
            sourcesUsed.push("googlePlaces");
        }
    }

    if (includeFirestore) {
        const firestoreLeads = await fetchFirestoreLeads({
            uid,
            limit: request.limit || 10,
            log,
        });
        if (firestoreLeads.length > 0) {
            leads.push(...firestoreLeads);
            sourcesUsed.push("firestore");
        }
    }

    let enrichedLeads = leads;
    if (request.includeEnrichment) {
        if (!firecrawlKey) {
            warnings.push("Firecrawl key missing; skipping website enrichment.");
        } else {
            enrichedLeads = await enrichLeadsWithFirecrawl(
                leads,
                firecrawlKey,
                { maxLeads: Math.min(request.limit || 10, 5), concurrency: 2 },
                log
            );
        }
    }

    if (sourcesUsed.length === 0) {
        warnings.push("No lead sources were available for this run.");
    }

    const criteria: LeadScoringCriteria = {
        targetIndustry: request.industry,
        keywords: request.query ? request.query.split(/\s+/).slice(0, 6) : [],
        location: request.location,
    };

    const scored = enrichedLeads.map((lead) => {
        const result = scoreLead(lead, criteria);
        return {
            ...lead,
            score: result.score,
            scoreSignals: result.signals,
        };
    });

    return { leads: scored, sourcesUsed, warnings };
}
