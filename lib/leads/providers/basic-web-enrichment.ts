import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;
const HREF_REGEX = /href=["']([^"'#]+)["']/gi;
const TITLE_REGEX = /<title[^>]*>([^<]+)<\/title>/i;
const META_DESCRIPTION_REGEX =
  /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i;

const SOCIAL_HOSTS: Array<{ key: keyof NonNullable<LeadCandidate["socialLinks"]>; host: string }> = [
  { key: "linkedin", host: "linkedin.com" },
  { key: "facebook", host: "facebook.com" },
  { key: "instagram", host: "instagram.com" },
  { key: "x", host: "x.com" },
  { key: "x", host: "twitter.com" },
  { key: "youtube", host: "youtube.com" },
  { key: "tiktok", host: "tiktok.com" },
];

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "").trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function mergeSocialLinks(
  base: LeadCandidate["socialLinks"] | undefined,
  incoming: LeadCandidate["socialLinks"] | undefined
): LeadCandidate["socialLinks"] | undefined {
  if (!base && !incoming) return undefined;
  const merged = { ...(base || {}), ...(incoming || {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function extractEmails(html: string): string[] {
  return uniq(
    (html.match(EMAIL_REGEX) || [])
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean)
      .filter((value) => !value.endsWith(".png") && !value.endsWith(".jpg") && !value.endsWith(".jpeg"))
  ).slice(0, 10);
}

function extractPhones(html: string): string[] {
  return uniq(
    (html.match(PHONE_REGEX) || [])
      .map((value) => normalizePhone(value))
      .filter(Boolean)
      .filter((value) => {
        const digits = value.replace(/[^\d]/g, "");
        return digits.length >= 10 && digits.length <= 15;
      })
  ).slice(0, 5);
}

function extractTitle(html: string): string | undefined {
  const match = html.match(TITLE_REGEX);
  if (!match || !match[1]) return undefined;
  const title = match[1].replace(/\s+/g, " ").trim();
  return title || undefined;
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(META_DESCRIPTION_REGEX);
  if (!match || !match[1]) return undefined;
  const description = match[1].replace(/\s+/g, " ").trim();
  return description || undefined;
}

function extractSocialLinks(html: string, website: string): LeadCandidate["socialLinks"] | undefined {
  const links = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    const href = String(match[1] || "").trim();
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, website);
    } catch {
      continue;
    }
    const protocol = absolute.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") continue;
    const host = absolute.hostname.toLowerCase().replace(/^www\./, "");
    for (const social of SOCIAL_HOSTS) {
      if (!host.endsWith(social.host)) continue;
      if (!links.has(social.key)) {
        links.set(social.key, absolute.toString());
      }
    }
  }

  if (links.size === 0) return undefined;
  const socialLinks: NonNullable<LeadCandidate["socialLinks"]> = {};
  for (const [key, value] of links.entries()) {
    socialLinks[key as keyof NonNullable<LeadCandidate["socialLinks"]>] = value;
  }
  return socialLinks;
}

function needsBasicEnrichment(lead: LeadCandidate): boolean {
  if (!lead.website || !isHttpUrl(lead.website)) return false;
  const missingEmail = !lead.email && (!lead.websiteEmails || lead.websiteEmails.length === 0);
  const missingPhone = !lead.phone && (!lead.phones || lead.phones.length === 0);
  const missingMetadata = !lead.websiteTitle || !lead.websiteDescription;
  const missingSocial = !lead.socialLinks || Object.keys(lead.socialLinks).length === 0;
  return missingEmail || missingPhone || missingMetadata || missingSocial;
}

async function fetchWebsiteHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "MissionControlLeadEnrichment/1.0 (+https://leadflow-review.web.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Website fetch failed (${response.status})`);
    }
    const html = await response.text();
    return html.slice(0, 350_000);
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichLeadWithBasicWebFetch(
  lead: LeadCandidate,
  options: { timeoutMs?: number } = {},
  log?: Logger
): Promise<LeadCandidate> {
  if (!needsBasicEnrichment(lead)) return lead;
  const timeoutMs = Math.max(1000, Math.min(20_000, Number(options.timeoutMs || 8000)));

  log?.info("lead.enrich.basic.start", { leadId: lead.id, website: lead.website });

  try {
    const html = await fetchWebsiteHtml(lead.website as string, timeoutMs);
    const emails = extractEmails(html);
    const phones = extractPhones(html);
    const socialLinks = extractSocialLinks(html, lead.website as string);

    const mergedWebsiteEmails = uniq([...(lead.websiteEmails || []), ...emails]).slice(0, 10);
    const mergedPhones = uniq([
      ...(lead.phones || []),
      ...(lead.phone ? [lead.phone] : []),
      ...phones,
    ]).slice(0, 5);

    const next: LeadCandidate = {
      ...lead,
      email: lead.email || emails[0],
      phone: lead.phone || phones[0],
      websiteEmails: mergedWebsiteEmails.length > 0 ? mergedWebsiteEmails : undefined,
      phones: mergedPhones.length > 0 ? mergedPhones : undefined,
      websiteTitle: lead.websiteTitle || extractTitle(html),
      websiteDescription: lead.websiteDescription || extractMetaDescription(html),
      socialLinks: mergeSocialLinks(lead.socialLinks, socialLinks),
      enriched: lead.enriched || emails.length > 0 || phones.length > 0 || Boolean(socialLinks),
    };

    log?.info("lead.enrich.basic.completed", {
      leadId: lead.id,
      emailsFound: emails.length,
      phonesFound: phones.length,
      socialFound: Boolean(socialLinks),
    });

    return next;
  } catch (error) {
    log?.warn("lead.enrich.basic.failed", {
      leadId: lead.id,
      website: lead.website,
      reason: error instanceof Error ? error.message : String(error),
    });
    return lead;
  }
}

async function poolMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function enrichLeadsWithBasicWebFetch(
  leads: LeadCandidate[],
  options: { maxLeads?: number; concurrency?: number; timeoutMs?: number } = {},
  log?: Logger
): Promise<LeadCandidate[]> {
  const maxLeads = Math.max(1, Math.min(20, Number(options.maxLeads || 8)));
  const concurrency = Math.max(1, Math.min(6, Number(options.concurrency || 2)));
  const timeoutMs = Math.max(1000, Math.min(20_000, Number(options.timeoutMs || 8000)));

  const candidates = leads.filter(needsBasicEnrichment).slice(0, maxLeads);
  if (candidates.length === 0) return leads;

  const enriched = await poolMap(candidates, concurrency, (lead) =>
    enrichLeadWithBasicWebFetch(lead, { timeoutMs }, log)
  );

  const byId = new Map(enriched.map((lead) => [lead.id, lead]));
  return leads.map((lead) => byId.get(lead.id) || lead);
}
