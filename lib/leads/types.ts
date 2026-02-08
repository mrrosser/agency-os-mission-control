export type LeadSource = "googlePlaces" | "firestore";

export interface LeadScoreSignals {
    industryMatch: boolean;
    keywordMatch: boolean;
    locationMatch: boolean;
    rating?: number;
    reviewCount?: number;
    hasWebsite: boolean;
    hasPhone: boolean;
    hasEmail: boolean;
}

export interface LeadCandidate {
    id: string;
    companyName: string;
    founderName?: string;
    email?: string;
    phone?: string;
    website?: string;
    websiteTitle?: string;
    websiteDescription?: string;
    websiteKeywords?: string;
    websiteEmails?: string[];
    location?: string;
    industry?: string;
    rating?: number;
    reviewCount?: number;
    source: LeadSource;
    score?: number;
    scoreSignals?: LeadScoreSignals;
    enriched?: boolean;
}

export interface LeadScoringCriteria {
    targetIndustry?: string;
    keywords?: string[];
    location?: string;
}

export interface LeadSourceRequest {
    query?: string;
    industry?: string;
    location?: string;
    limit?: number;
    minScore?: number;
    sources?: LeadSource[];
    includeEnrichment?: boolean;
}

export interface LeadSourceResponse {
    runId: string;
    leads: LeadCandidate[];
    sourcesUsed: LeadSource[];
    warnings?: string[];
}
