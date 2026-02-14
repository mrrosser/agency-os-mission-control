import type { LeadCandidate } from "@/lib/leads/types";

export type LeadExportable = Partial<
  Pick<
    LeadCandidate,
    | "companyName"
    | "website"
    | "websiteDomain"
    | "googleMapsUrl"
    | "email"
    | "phone"
    | "phones"
    | "location"
    | "industry"
    | "rating"
    | "reviewCount"
    | "businessStatus"
    | "openNow"
    | "priceLevel"
    | "score"
  >
> & {
  socialLinks?: LeadCandidate["socialLinks"];
  // Receipts and other sources may not have the strict LeadSource union type.
  source?: string;
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, `""`)}"`;
  }
  return str;
}

function socialsToText(socialLinks: LeadCandidate["socialLinks"]): string {
  if (!socialLinks) return "";
  const entries = Object.entries(socialLinks).filter(([, value]) => typeof value === "string" && value.length > 0);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}:${value}`)
    .join(" ");
}

export function leadsToCsv(leads: LeadExportable[]): string {
  const header = [
    "companyName",
    "website",
    "websiteDomain",
    "googleMapsUrl",
    "email",
    "phone",
    "phones",
    "location",
    "industry",
    "rating",
    "reviewCount",
    "businessStatus",
    "openNow",
    "priceLevel",
    "socialLinks",
    "score",
    "source",
  ];

  const rows = leads.map((lead) => {
    return [
      lead.companyName,
      lead.website,
      lead.websiteDomain,
      lead.googleMapsUrl,
      lead.email,
      lead.phone,
      Array.isArray(lead.phones) ? lead.phones.join(" ") : undefined,
      lead.location,
      lead.industry,
      typeof lead.rating === "number" ? lead.rating.toFixed(1) : lead.rating,
      lead.reviewCount,
      lead.businessStatus,
      typeof lead.openNow === "boolean" ? String(lead.openNow) : undefined,
      lead.priceLevel,
      socialsToText(lead.socialLinks),
      lead.score,
      lead.source,
    ].map(csvEscape);
  });

  return [header.map(csvEscape).join(","), ...rows.map((row) => row.join(","))].join("\n");
}
