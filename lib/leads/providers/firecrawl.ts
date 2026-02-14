import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";
import { firecrawlScrape } from "@/lib/firecrawl/client";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Fairly permissive US-first phone matcher. We keep extraction conservative by
// validating digit counts after matching.
const PHONE_REGEX = /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;

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

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  const normalized = matches
    .map((email) => email.toLowerCase().trim())
    .filter(Boolean)
    // Avoid common false-positives.
    .filter((email) => !email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".jpeg") && !email.endsWith(".gif"));
  return uniq(normalized).slice(0, 10);
}

function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_REGEX) || [];
  const cleaned = matches
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/[^\d+]/g, ""))
    .filter((value) => {
      const digits = value.replace(/[^\d]/g, "");
      return digits.length >= 10 && digits.length <= 15;
    });
  return uniq(cleaned).slice(0, 5);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function toAbsoluteHttpUrl(maybeUrl: string, base: string): string | null {
  try {
    const resolved = new URL(maybeUrl, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function isSameSite(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function extractSocialLinks(links: string[], domain: string): LeadCandidate["socialLinks"] {
  const socials: NonNullable<LeadCandidate["socialLinks"]> = {};
  for (const raw of links) {
    const abs = toAbsoluteHttpUrl(raw, `https://${domain}`);
    if (!abs) continue;
    let host: string;
    try {
      host = new URL(abs).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }

    for (const match of SOCIAL_HOSTS) {
      if (!host.endsWith(match.host)) continue;
      if (socials[match.key]) continue;
      socials[match.key] = abs;
    }
  }
  return Object.keys(socials).length > 0 ? socials : undefined;
}

function pickContactPage(links: string[], website: string, domain: string): string | null {
  const candidates = links
    .map((link) => toAbsoluteHttpUrl(link, website))
    .filter((value): value is string => Boolean(value))
    .filter((value) => isSameSite(value, domain));

  const prioritized = candidates.find((value) => /\/contact(\/|$|\?)/i.test(value));
  if (prioritized) return prioritized;

  // Fall back to a best-effort /contact path when the link list is sparse.
  try {
    const fallback = new URL("/contact", website);
    return fallback.toString();
  } catch {
    return null;
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

export async function enrichLeadWithFirecrawl(
  lead: LeadCandidate,
  apiKey: string,
  log?: Logger
): Promise<LeadCandidate> {
  if (!lead.website || !isHttpUrl(lead.website)) return lead;

  const domain = extractDomain(lead.website);
  const needsEmail = !lead.email;
  const needsPhone = !lead.phone;
  const needsSocial = !lead.socialLinks || Object.keys(lead.socialLinks).length === 0;
  const needsMetadata = !lead.websiteTitle || !lead.websiteDescription;

  // Still populate websiteDomain without spending credits.
  const base: LeadCandidate = domain && lead.websiteDomain !== domain ? { ...lead, websiteDomain: domain } : lead;
  if (base.email) return base;

  if (!needsEmail && !needsPhone && !needsSocial && !needsMetadata) return base;

  log?.info("lead.enrich.firecrawl.start", { leadId: lead.id, website: lead.website });

  try {
    const scrape = await firecrawlScrape(
      base.website as string,
      apiKey,
      { onlyMainContent: true, formats: ["markdown", "links"], timeoutMs: 25_000 },
      log
    );

    const markdown = scrape.markdown || "";
    const emails = markdown ? extractEmails(markdown) : [];
    const phones = markdown ? extractPhones(markdown) : [];
    const primaryEmail = emails[0];
    const primaryPhone = phones[0];
    const links = Array.isArray(scrape.links) ? scrape.links : [];
    const socials = domain ? extractSocialLinks(links, domain) : undefined;

    let contactMarkdown = "";
    const emailResolved = Boolean(base.email || primaryEmail);
    // Only spend an extra scrape when we still haven't found an email.
    // (Phone is usually already provided by Places; this keeps Firecrawl costs predictable.)
    const shouldTryContact = Boolean(domain) && !emailResolved && (needsEmail || needsPhone || needsSocial);

    if (domain && shouldTryContact) {
      const contactUrl = pickContactPage(links, base.website as string, domain);
      if (contactUrl && contactUrl !== base.website) {
        const contact = await firecrawlScrape(
          contactUrl,
          apiKey,
          { onlyMainContent: true, formats: ["markdown"], timeoutMs: 20_000 },
          log
        );
        contactMarkdown = contact.markdown || "";
      }
    }

    const contactEmails = contactMarkdown ? extractEmails(contactMarkdown) : [];
    const contactPhones = contactMarkdown ? extractPhones(contactMarkdown) : [];

    const mergedEmails = uniq([...(emails || []), ...(contactEmails || [])]).slice(0, 10);
    const mergedPhones = uniq([...(phones || []), ...(contactPhones || [])]).slice(0, 5);
    const bestEmail = base.email || mergedEmails[0];
    const bestPhone = base.phone || mergedPhones[0];

    const next: LeadCandidate = {
      ...base,
      email: bestEmail,
      phone: bestPhone,
      phones: base.phones || (mergedPhones.length > 0 ? mergedPhones : undefined),
      websiteTitle: base.websiteTitle || (scrape.metadata?.title as string | undefined),
      websiteDescription: base.websiteDescription || (scrape.metadata?.description as string | undefined),
      websiteKeywords: base.websiteKeywords || (scrape.metadata?.keywords as string | undefined),
      websiteEmails: base.websiteEmails || (mergedEmails.length > 0 ? mergedEmails : undefined),
      socialLinks: base.socialLinks || socials,
      enriched:
        base.enriched ||
        Boolean(primaryEmail) ||
        Boolean(primaryPhone) ||
        Boolean(scrape.metadata?.title) ||
        Boolean(scrape.metadata?.description) ||
        Boolean(socials),
    };

    log?.info("lead.enrich.firecrawl.completed", {
      leadId: base.id,
      foundEmails: mergedEmails.length,
      foundPhones: mergedPhones.length,
      setEmail: Boolean(primaryEmail),
      setPhone: Boolean(primaryPhone),
    });

    return next;
  } catch (error) {
    log?.warn("lead.enrich.firecrawl.failed", {
      leadId: base.id,
      website: base.website,
      reason: error instanceof Error ? error.message : String(error),
    });
    return base;
  }
}

export async function enrichLeadsWithFirecrawl(
  leads: LeadCandidate[],
  apiKey: string,
  options: { maxLeads?: number; concurrency?: number } = {},
  log?: Logger
): Promise<LeadCandidate[]> {
  const maxLeads = options.maxLeads ?? 5;
  const concurrency = options.concurrency ?? 2;

  const candidates = leads
    .filter((lead) => Boolean(lead.website) && !lead.email)
    .slice(0, maxLeads);

  if (candidates.length === 0) return leads;

  const enriched = await poolMap(candidates, concurrency, (lead) =>
    enrichLeadWithFirecrawl(lead, apiKey, log)
  );

  const byId = new Map(enriched.map((lead) => [lead.id, lead]));
  return leads.map((lead) => byId.get(lead.id) || lead);
}
