import type { LeadCandidate, LeadScoreSignals, LeadScoringCriteria } from "./types";

const MAX_SCORE = 100;

function normalize(value?: string) {
    return (value || "").toLowerCase().trim();
}

function contains(haystack: string, needle: string) {
    return haystack.includes(needle);
}

export function scoreLead(candidate: LeadCandidate, criteria: LeadScoringCriteria = {}) {
    const industry = normalize(criteria.targetIndustry);
    const location = normalize(criteria.location);
    const keywords = (criteria.keywords || []).map(normalize).filter(Boolean);

    const companyName = normalize(candidate.companyName);
    const candidateIndustry = normalize(candidate.industry);
    const candidateLocation = normalize(candidate.location);
    const website = normalize(candidate.website);

    const industryMatch = Boolean(industry) && (contains(candidateIndustry, industry) || contains(companyName, industry));
    const locationMatch = Boolean(location) && contains(candidateLocation, location);
    const keywordMatch = keywords.length > 0 && keywords.some((keyword) =>
        contains(companyName, keyword) || contains(candidateIndustry, keyword) || contains(website, keyword)
    );

    const rating = candidate.rating;
    const reviewCount = candidate.reviewCount;

    const hasWebsite = Boolean(candidate.website);
    const hasPhone = Boolean(candidate.phone);
    const hasEmail = Boolean(candidate.email);

    let score = 0;
    if (industryMatch) score += 30;
    if (keywordMatch) score += 15;
    if (locationMatch) score += 10;

    if (typeof rating === "number") {
        score += Math.round((Math.min(Math.max(rating, 0), 5) / 5) * 20);
    }

    if (typeof reviewCount === "number") {
        const normalized = Math.min(reviewCount, 200) / 200;
        score += Math.round(normalized * 15);
    }

    if (hasWebsite) score += 5;
    if (hasPhone) score += 3;
    if (hasEmail) score += 7;

    score = Math.min(MAX_SCORE, Math.max(0, score));

    const signals: LeadScoreSignals = {
        industryMatch,
        keywordMatch,
        locationMatch,
        rating,
        reviewCount,
        hasWebsite,
        hasPhone,
        hasEmail,
    };

    return { score, signals };
}
