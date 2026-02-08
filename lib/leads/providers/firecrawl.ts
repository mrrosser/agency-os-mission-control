import "server-only";

import type { Logger } from "@/lib/logging";
import type { LeadCandidate } from "@/lib/leads/types";
import { firecrawlScrape } from "@/lib/firecrawl/client";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
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
  if (lead.email) return lead;

  log?.info("lead.enrich.firecrawl.start", { leadId: lead.id, website: lead.website });

  try {
    const scrape = await firecrawlScrape(
      lead.website,
      apiKey,
      { onlyMainContent: true, formats: ["markdown"], timeoutMs: 25_000 },
      log
    );

    const markdown = scrape.markdown || "";
    const emails = markdown ? extractEmails(markdown) : [];
    const primaryEmail = emails[0];

    const next: LeadCandidate = {
      ...lead,
      email: lead.email || primaryEmail,
      websiteTitle: lead.websiteTitle || (scrape.metadata?.title as string | undefined),
      websiteDescription: lead.websiteDescription || (scrape.metadata?.description as string | undefined),
      websiteKeywords: lead.websiteKeywords || (scrape.metadata?.keywords as string | undefined),
      websiteEmails: lead.websiteEmails || (emails.length > 0 ? emails : undefined),
      enriched: lead.enriched || Boolean(primaryEmail) || Boolean(scrape.metadata?.title) || Boolean(scrape.metadata?.description),
    };

    log?.info("lead.enrich.firecrawl.completed", {
      leadId: lead.id,
      foundEmails: emails.length,
      setEmail: Boolean(primaryEmail),
    });

    return next;
  } catch (error) {
    log?.warn("lead.enrich.firecrawl.failed", {
      leadId: lead.id,
      website: lead.website,
      reason: error instanceof Error ? error.message : String(error),
    });
    return lead;
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

