import "server-only";

import type { Logger } from "@/lib/logging";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v1";

interface FirecrawlErrorResponse {
  success?: false;
  error?: string;
  message?: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    links?: string[];
    metadata?: FirecrawlScrapeMetadata;
    warning?: string;
  };
  error?: string;
}

export interface FirecrawlScrapeResult {
  markdown?: string;
  links?: string[];
  metadata?: FirecrawlScrapeMetadata;
  warning?: string;
}

export interface FirecrawlScrapeMetadata {
  title?: string;
  description?: string;
  keywords?: string;
  language?: string;
  sourceURL?: string;
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function firecrawlScrape(
  url: string,
  apiKey: string,
  options: {
    onlyMainContent?: boolean;
    timeoutMs?: number;
    formats?: Array<"markdown" | "html" | "rawHtml" | "links" | "screenshot">;
  } = {},
  log?: Logger
): Promise<FirecrawlScrapeResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const onlyMainContent = options.onlyMainContent ?? true;
  const formats = options.formats ?? ["markdown"];

  log?.info("firecrawl.scrape.requested", {
    url,
    onlyMainContent,
    formats,
    timeoutMs,
  });

  const endpoint = `${FIRECRAWL_BASE_URL}/scrape`;
  const { controller, timeout } = withTimeout(timeoutMs + 2_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        onlyMainContent,
        formats,
        timeout: timeoutMs,
        removeBase64Images: true,
        blockAds: true,
        storeInCache: true,
      }),
    });

    const payload = (await safeJson(response)) as FirecrawlScrapeResponse | FirecrawlErrorResponse | string | null;

    if (!response.ok) {
      const message =
        typeof payload === "string"
          ? payload
          : (payload as FirecrawlErrorResponse | FirecrawlScrapeResponse | null)?.error ||
            (payload as FirecrawlErrorResponse | null)?.message ||
            `Firecrawl scrape failed (${response.status})`;
      log?.warn("firecrawl.scrape.failed", { url, status: response.status, message });
      throw new Error(message);
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Firecrawl returned an unexpected response");
    }

    const typed = payload as FirecrawlScrapeResponse;
    if (!typed.success) {
      const message = typed.error || "Firecrawl scrape failed";
      log?.warn("firecrawl.scrape.failed", { url, status: response.status, message });
      throw new Error(message);
    }

    const result: FirecrawlScrapeResult = {
      markdown: typed.data?.markdown,
      links: Array.isArray(typed.data?.links) ? typed.data?.links : undefined,
      metadata: typed.data?.metadata,
      warning: typed.data?.warning,
    };

    log?.info("firecrawl.scrape.completed", {
      url,
      hasMarkdown: Boolean(result.markdown),
      linkCount: result.links?.length ?? 0,
      statusCode: result.metadata?.statusCode,
      warning: result.warning || null,
    });

    return result;
  } finally {
    clearTimeout(timeout);
  }
}
