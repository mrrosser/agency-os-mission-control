import type { Logger } from "@/lib/logging";
import type {
    LeadCandidate,
    LeadContactCandidate,
    LeadContactConfidence,
    LeadContactSource,
    LeadScoringCriteria,
    LeadSource,
    LeadSourceRequest,
} from "@/lib/leads/types";
import { scoreLead } from "@/lib/leads/scoring";
import { enrichLeadsWithFirecrawl } from "@/lib/leads/providers/firecrawl";
import { resolveLeadProviders } from "@/lib/leads/providers/registry";

interface SourceContext {
    uid: string;
    googlePlacesKey?: string;
    firecrawlKey?: string;
    apifyToken?: string;
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
        budget: {
            maxCostUsd: number;
            maxPages: number;
            maxRuntimeSec: number;
            costUsedUsd: number;
            pagesUsed: number;
            runtimeSec: number;
            stopped: boolean;
            stopReason?: string;
            stopProvider?: LeadSource;
        };
    };
}

interface NormalizedBudget {
    maxCostUsd: number;
    maxPages: number;
    maxRuntimeSec: number;
}

interface BudgetUsage {
    costUsedUsd: number;
    pagesUsed: number;
    stopped: boolean;
    stopReason?: string;
    stopProvider?: LeadSource;
}

function readPositiveFloat(value: string | undefined, fallback: number): number {
    const parsed = Number.parseFloat(value || "");
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function normalizeBudget(request: LeadSourceRequest): NormalizedBudget {
    const defaultCost = readPositiveFloat(process.env.LEAD_SOURCE_BUDGET_MAX_COST_USD, 2);
    const defaultPages = readPositiveInt(process.env.LEAD_SOURCE_BUDGET_MAX_PAGES, 4);
    const defaultRuntimeSec = readPositiveInt(process.env.LEAD_SOURCE_BUDGET_MAX_RUNTIME_SEC, 50);

    const maxCostUsd = Number.isFinite(Number(request.budget?.maxCostUsd))
        ? Math.min(100, Math.max(0.05, Number(request.budget?.maxCostUsd)))
        : defaultCost;
    const maxPages = Number.isFinite(Number(request.budget?.maxPages))
        ? Math.min(20, Math.max(1, Math.round(Number(request.budget?.maxPages))))
        : defaultPages;
    const maxRuntimeSec = Number.isFinite(Number(request.budget?.maxRuntimeSec))
        ? Math.min(180, Math.max(5, Math.round(Number(request.budget?.maxRuntimeSec))))
        : defaultRuntimeSec;

    return {
        maxCostUsd,
        maxPages,
        maxRuntimeSec,
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

function confidenceRank(value: LeadContactConfidence): number {
    switch (value) {
        case "high":
            return 3;
        case "medium":
            return 2;
        case "low":
            return 1;
        default:
            return 0;
    }
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
    return value.trim().replace(/[^\d+]/g, "");
}

function mergeCandidate(
    map: Map<string, LeadContactCandidate>,
    candidate: LeadContactCandidate,
    key: string
): void {
    const existing = map.get(key);
    if (!existing) {
        map.set(key, candidate);
        return;
    }
    const a = confidenceRank(existing.confidence);
    const b = confidenceRank(candidate.confidence);
    if (b > a) {
        map.set(key, candidate);
    }
}

function buildEmailCandidates(lead: LeadCandidate): LeadContactCandidate[] | undefined {
    const map = new Map<string, LeadContactCandidate>();

    const primary = (lead.email || "").trim();
    if (primary) {
        const source: LeadContactSource = lead.source === "firestore" ? "firestore" : "firecrawl";
        const confidence: LeadContactConfidence = lead.source === "firestore" ? "high" : "medium";
        mergeCandidate(
            map,
            { value: primary, source, confidence },
            normalizeEmail(primary)
        );
    }

    if (Array.isArray(lead.websiteEmails)) {
        for (const email of lead.websiteEmails) {
            const trimmed = (email || "").trim();
            if (!trimmed) continue;
            mergeCandidate(
                map,
                { value: trimmed, source: "firecrawl", confidence: "medium" },
                normalizeEmail(trimmed)
            );
        }
    }

    const values = Array.from(map.values());
    if (values.length === 0) return undefined;
    values.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
    return values;
}

function buildPhoneCandidates(lead: LeadCandidate): LeadContactCandidate[] | undefined {
    const map = new Map<string, LeadContactCandidate>();

    const primary = (lead.phone || "").trim();
    if (primary) {
        const source: LeadContactSource = lead.source === "googlePlaces" ? "googlePlaces" : "firestore";
        mergeCandidate(
            map,
            { value: primary, source, confidence: "high" },
            normalizePhone(primary)
        );
    }

    if (Array.isArray(lead.phones)) {
        for (const phone of lead.phones) {
            const trimmed = (phone || "").trim();
            if (!trimmed) continue;
            const source: LeadContactSource =
                lead.source === "googlePlaces"
                    ? "firecrawl"
                    : primary
                        ? "firestore"
                        : "firecrawl";
            const confidence: LeadContactConfidence =
                source === "firestore" ? "high" : "medium";
            mergeCandidate(
                map,
                { value: trimmed, source, confidence },
                normalizePhone(trimmed)
            );
        }
    }

    const values = Array.from(map.values());
    if (values.length === 0) return undefined;
    values.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
    return values;
}

function withContactCandidates(lead: LeadCandidate): LeadCandidate {
    return {
        ...lead,
        emailCandidates: buildEmailCandidates(lead),
        phoneCandidates: buildPhoneCandidates(lead),
    };
}

export async function sourceLeads(
    request: LeadSourceRequest,
    context: SourceContext
): Promise<SourceResult> {
    const { uid, googlePlacesKey, firecrawlKey, apifyToken, log } = context;
    const warnings: string[] = [];
    const sourcesRequested = request.sources ?? [];
    const defaultSources: LeadSource[] = ["googlePlaces", "firestore"];
    let sources = (sourcesRequested.length > 0 ? sourcesRequested : defaultSources)
        .filter((source, index, arr) => arr.indexOf(source) === index);
    // Optional provider fallback: if Places is requested but key is unavailable, use Apify Maps when configured.
    if (
        !googlePlacesKey &&
        apifyToken &&
        sources.includes("googlePlaces") &&
        !sources.includes("apifyMaps")
    ) {
        sources = sources.map((source) => (source === "googlePlaces" ? "apifyMaps" : source));
        warnings.push("Google Places key missing; using Apify Maps fallback.");
    }
    const providers = resolveLeadProviders(sources);
    const budget = normalizeBudget(request);
    const usage: BudgetUsage = {
        costUsedUsd: 0,
        pagesUsed: 0,
        stopped: false,
    };
    const startedAtMs = Date.now();

    const leads: LeadCandidate[] = [];
    const sourcesUsed: LeadSource[] = [];
    for (const provider of providers) {
        const elapsedSec = Math.floor((Date.now() - startedAtMs) / 1000);
        if (elapsedSec >= budget.maxRuntimeSec) {
            usage.stopped = true;
            usage.stopReason = "runtime_limit";
            usage.stopProvider = provider.source;
            warnings.push("Sourcing stopped because runtime budget was reached.");
            break;
        }
        if (usage.pagesUsed >= budget.maxPages) {
            usage.stopped = true;
            usage.stopReason = "page_limit";
            usage.stopProvider = provider.source;
            warnings.push("Sourcing stopped because page budget was reached.");
            break;
        }
        if (usage.costUsedUsd >= budget.maxCostUsd) {
            usage.stopped = true;
            usage.stopReason = "cost_limit";
            usage.stopProvider = provider.source;
            warnings.push("Sourcing stopped because cost budget was reached.");
            break;
        }

        const result = await provider.run({
            request,
            uid,
            googlePlacesKey,
            apifyToken,
            budget: {
                remainingPages: Math.max(1, budget.maxPages - usage.pagesUsed),
                remainingRuntimeSec: Math.max(5, budget.maxRuntimeSec - elapsedSec),
            },
            log,
        });

        if (result.leads.length > 0) {
            leads.push(...result.leads);
            sourcesUsed.push(result.source);
        }
        if (result.warnings.length > 0) {
            warnings.push(...result.warnings);
        }
        usage.pagesUsed += Math.max(0, result.pagesUsed);
        usage.costUsedUsd += Math.max(0, result.estimatedCostUsd);
        if (!usage.stopped && usage.pagesUsed >= budget.maxPages) {
            usage.stopped = true;
            usage.stopReason = "page_limit";
            usage.stopProvider = provider.source;
        }
        if (!usage.stopped && usage.costUsedUsd >= budget.maxCostUsd) {
            usage.stopped = true;
            usage.stopReason = "cost_limit";
            usage.stopProvider = provider.source;
        }
    }

    usage.costUsedUsd = Number(usage.costUsedUsd.toFixed(4));
    if (usage.stopped) {
        if (usage.stopReason === "cost_limit") {
            warnings.push(
                `Budget guardrail: max cost $${budget.maxCostUsd.toFixed(2)} reached.`
            );
        } else if (usage.stopReason === "page_limit") {
            warnings.push(
                `Budget guardrail: max pages ${budget.maxPages} reached.`
            );
        } else if (usage.stopReason === "runtime_limit") {
            warnings.push(
                `Budget guardrail: max runtime ${budget.maxRuntimeSec}s reached.`
            );
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

    const leadsWithCandidates = enrichedLeads.map(withContactCandidates);

    const scored = leadsWithCandidates.map((lead) => {
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

    const runtimeSec = Math.floor((Date.now() - startedAtMs) / 1000);

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
            budget: {
                maxCostUsd: budget.maxCostUsd,
                maxPages: budget.maxPages,
                maxRuntimeSec: budget.maxRuntimeSec,
                costUsedUsd: usage.costUsedUsd,
                pagesUsed: usage.pagesUsed,
                runtimeSec,
                stopped: usage.stopped,
                stopReason: usage.stopReason,
                stopProvider: usage.stopProvider,
            },
        },
    };
}
