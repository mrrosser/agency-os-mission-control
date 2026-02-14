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
    diagnostics?: {
        rawCount: number;
        dedupedCount: number;
        duplicatesRemoved: number;
        domainClusters: number;
        maxDomainClusterSize: number;
    };
}

function extractDomain(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return null;
    }
}

function normalizeKey(value?: string): string {
    return (value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function buildDedupeKey(lead: LeadCandidate): string {
    const name = normalizeKey(lead.companyName);
    const location = normalizeKey(lead.location);
    const domain = normalizeKey(lead.websiteDomain);

    // Prefer name+location when available (Google Places typically provides an address).
    if (name && location) return `nl:${name}|${location}`;
    // Fall back to name+domain (useful for Firestore leads with sparse location).
    if (name && domain) return `nd:${name}|${domain}`;
    // Last resort: stable source id.
    return `id:${lead.source}:${lead.id}`;
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

    const rawWithDomain = leads.map((lead) => {
        if (lead.websiteDomain) return lead;
        const domain = lead.website ? extractDomain(lead.website) : null;
        return domain ? { ...lead, websiteDomain: domain } : lead;
    });

    // Domain clustering signal (helpful for explaining repeated results).
    const domainCounts = new Map<string, number>();
    for (const lead of rawWithDomain) {
        if (!lead.websiteDomain) continue;
        domainCounts.set(lead.websiteDomain, (domainCounts.get(lead.websiteDomain) || 0) + 1);
    }
    const domainClusters = Array.from(domainCounts.values()).filter((count) => count > 1).length;
    const maxDomainClusterSize = Math.max(0, ...Array.from(domainCounts.values()));

    let enrichedLeads = rawWithDomain.map((lead) => {
        const count = lead.websiteDomain ? domainCounts.get(lead.websiteDomain) : undefined;
        return count && count > 1 ? { ...lead, domainClusterSize: count } : lead;
    });
    if (request.includeEnrichment) {
        if (!firecrawlKey) {
            warnings.push("Firecrawl key missing; skipping website enrichment.");
        } else {
            enrichedLeads = await enrichLeadsWithFirecrawl(
                enrichedLeads,
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

    // Conservative dedupe after scoring (keep the "best" record per key).
    const byKey = new Map<string, LeadCandidate>();
    for (const lead of scored) {
        const key = buildDedupeKey(lead);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, lead);
            continue;
        }

        const scoreA = Number(existing.score || 0);
        const scoreB = Number(lead.score || 0);
        if (scoreB > scoreA) {
            byKey.set(key, lead);
        }
    }
    const deduped = Array.from(byKey.values());
    const duplicatesRemoved = Math.max(0, scored.length - deduped.length);
    if (duplicatesRemoved > 0) {
        warnings.push(`Removed ${duplicatesRemoved} duplicate lead(s) (name/location or name/domain match).`);
    }
    if (domainClusters > 0) {
        warnings.push(`Detected ${domainClusters} domain cluster(s) (max size ${maxDomainClusterSize}).`);
    }

    return {
        leads: deduped,
        sourcesUsed,
        warnings,
        diagnostics: {
            rawCount: leads.length,
            dedupedCount: deduped.length,
            duplicatesRemoved,
            domainClusters,
            maxDomainClusterSize,
        },
    };
}
