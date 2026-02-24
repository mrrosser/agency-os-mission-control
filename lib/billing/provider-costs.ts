import "server-only";

import { resolveSecret } from "@/lib/api/secrets";
import type {
  ControlPlaneBillingInput,
  ControlPlaneBillingProviderId,
  ControlPlaneBillingProviderSnapshot,
} from "@/lib/agent-control-plane";
import type { Logger } from "@/lib/logging";

interface PullProviderBillingInput {
  uid: string;
  log: Logger;
  now?: Date;
  fetchImpl?: typeof fetch;
  bypassCache?: boolean;
}

const OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs";
const TWILIO_USAGE_URL = "https://api.twilio.com/2010-04-01/Accounts";
const ELEVENLABS_SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription";
const ELEVENLABS_USAGE_URL = "https://api.elevenlabs.io/v1/usage/character-stats";
const BILLING_TIMEOUT_MS = 12_000;
const DEFAULT_BILLING_CACHE_TTL_MS = 120_000;

interface BillingCacheEntry {
  snapshot: ControlPlaneBillingInput;
  expiresAtMs: number;
}

function readCacheTtlMs(): number {
  const parsed = Number(process.env.CONTROL_PLANE_BILLING_CACHE_TTL_MS || DEFAULT_BILLING_CACHE_TTL_MS);
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_BILLING_CACHE_TTL_MS;
  return Math.floor(parsed);
}

const billingCache = new Map<string, BillingCacheEntry>();
const billingInFlight = new Map<string, Promise<ControlPlaneBillingInput>>();

type ProviderWindow = {
  startIso: string;
  endIso: string;
  startUnix: number;
  endUnix: number;
};

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function currentMonthWindow(now: Date): ProviderWindow {
  const endUnix = Math.floor(now.getTime() / 1000);
  const startUnix = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  return {
    startIso: new Date(startUnix * 1000).toISOString(),
    endIso: new Date(endUnix * 1000).toISOString(),
    startUnix,
    endUnix,
  };
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

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number = BILLING_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function providerResult(
  providerId: ControlPlaneBillingProviderId,
  label: string,
  source: string,
  status: ControlPlaneBillingProviderSnapshot["status"],
  detail: string,
  monthlyCostUsd: number | null = null,
  currency: string | null = null
): ControlPlaneBillingProviderSnapshot {
  return {
    providerId,
    label,
    source,
    status,
    detail,
    monthlyCostUsd: monthlyCostUsd === null ? null : roundUsd(monthlyCostUsd),
    currency,
  };
}

export function clearProviderBillingCache(): void {
  billingCache.clear();
  billingInFlight.clear();
}

export function parseOpenAiMonthlyCost(payload: unknown): {
  monthlyCostUsd: number | null;
  currency: string | null;
} {
  const root = asObject(payload);
  if (!root) return { monthlyCostUsd: null, currency: null };

  const buckets = Array.isArray(root.data) ? root.data : [];
  let total = 0;
  let found = false;
  let currency: string | null = null;

  for (const bucket of buckets) {
    const bucketObj = asObject(bucket);
    if (!bucketObj) continue;
    const results = Array.isArray(bucketObj.results) ? bucketObj.results : [];
    for (const result of results) {
      const resultObj = asObject(result);
      if (!resultObj) continue;
      const amountObj = asObject(resultObj.amount);
      const value = toFiniteNumber(amountObj?.value);
      if (value === null) continue;
      total += value;
      found = true;
      currency = normalizeCurrency(amountObj?.currency) || currency;
    }
  }

  return { monthlyCostUsd: found ? roundUsd(total) : null, currency };
}

export function parseTwilioMonthlyCost(payload: unknown): {
  monthlyCostUsd: number | null;
  currency: string | null;
} {
  const root = asObject(payload);
  if (!root) return { monthlyCostUsd: null, currency: null };

  const records = Array.isArray(root.usage_records) ? root.usage_records : [];
  let total = 0;
  let found = false;
  let currency: string | null = null;

  for (const record of records) {
    const recordObj = asObject(record);
    if (!recordObj) continue;
    const price = toFiniteNumber(recordObj.price);
    if (price === null) continue;
    total += Math.abs(price);
    found = true;
    currency = normalizeCurrency(recordObj.price_unit) || currency;
  }

  return { monthlyCostUsd: found ? roundUsd(total) : null, currency };
}

function parseElevenLabsInvoiceCost(payload: unknown): {
  monthlyCostUsd: number | null;
  currency: string | null;
} {
  const root = asObject(payload);
  if (!root) return { monthlyCostUsd: null, currency: null };

  const currency = normalizeCurrency(root.currency);
  const directUsdKeys = [
    "current_month_spend_usd",
    "month_to_date_spend_usd",
    "billing_period_spend_usd",
  ] as const;

  for (const key of directUsdKeys) {
    const value = toFiniteNumber(root[key]);
    if (value !== null) {
      return { monthlyCostUsd: roundUsd(value), currency };
    }
  }

  const nextInvoice = asObject(root.next_invoice);
  const directCents =
    toFiniteNumber(root.amount_due_cents) ??
    toFiniteNumber(nextInvoice?.amount_due_cents) ??
    toFiniteNumber(nextInvoice?.invoice_amount_cents);
  if (directCents !== null) {
    return {
      monthlyCostUsd: roundUsd(Math.max(0, directCents) / 100),
      currency,
    };
  }

  const openInvoices = root.open_invoices;
  if (Array.isArray(openInvoices)) {
    let centsTotal = 0;
    let found = false;
    for (const invoice of openInvoices) {
      const invoiceObj = asObject(invoice);
      const cents =
        toFiniteNumber(invoiceObj?.amount_due_cents) ??
        toFiniteNumber(invoiceObj?.invoice_amount_cents) ??
        toFiniteNumber(invoiceObj?.total_amount_cents);
      if (cents === null) continue;
      centsTotal += Math.max(0, cents);
      found = true;
    }
    if (found) {
      return { monthlyCostUsd: roundUsd(centsTotal / 100), currency };
    }
  }

  return { monthlyCostUsd: null, currency };
}

function parseElevenLabsUsageCost(payload: unknown): {
  monthlyCostUsd: number | null;
  currency: string | null;
} {
  const root = asObject(payload);
  if (!root) return { monthlyCostUsd: null, currency: null };

  const currency = normalizeCurrency(root.currency);
  const topLevel =
    toFiniteNumber(root.total_cost_usd) ??
    toFiniteNumber(root.month_cost_usd) ??
    toFiniteNumber(root.cost_usd);
  if (topLevel !== null) {
    return { monthlyCostUsd: roundUsd(topLevel), currency };
  }

  const usageRows = Array.isArray(root.character_stats)
    ? root.character_stats
    : Array.isArray(root.data)
      ? root.data
      : [];
  let total = 0;
  let found = false;
  for (const row of usageRows) {
    const rowObj = asObject(row);
    if (!rowObj) continue;
    const rowCost = toFiniteNumber(rowObj.cost_usd) ?? toFiniteNumber(rowObj.total_cost_usd);
    if (rowCost === null) continue;
    total += Math.max(0, rowCost);
    found = true;
  }

  return { monthlyCostUsd: found ? roundUsd(total) : null, currency };
}

async function pullOpenAiCost(args: {
  uid: string;
  window: ProviderWindow;
  log: Logger;
  fetchImpl: typeof fetch;
}): Promise<ControlPlaneBillingProviderSnapshot> {
  const adminKey =
    process.env.OPENAI_ADMIN_API_KEY?.trim() || process.env.OPENAI_ORG_ADMIN_KEY?.trim() || null;
  const key = adminKey || (await resolveSecret(args.uid, "openaiKey", "OPENAI_API_KEY"));
  if (!key) {
    return providerResult(
      "openai",
      "OpenAI",
      "organization.costs",
      "missing_credentials",
      "Missing OpenAI API key for billing pull.",
      null
    );
  }

  const url = new URL(OPENAI_COSTS_URL);
  url.searchParams.set("start_time", String(args.window.startUnix));
  url.searchParams.set("end_time", String(args.window.endUnix));
  url.searchParams.set("bucket_width", "1d");

  args.log.info("billing.openai.requested", {
    provider: "openai",
    startIso: args.window.startIso,
    endIso: args.window.endIso,
  });

  try {
    const response = await fetchWithTimeout(args.fetchImpl, url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    const payload = await safeJson(response);

    if (response.status === 401 || response.status === 403) {
      return providerResult(
        "openai",
        "OpenAI",
        "organization.costs",
        "unauthorized",
        "OpenAI billing endpoint requires an org admin key.",
        null
      );
    }

    if (!response.ok) {
      args.log.warn("billing.openai.failed", {
        provider: "openai",
        status: response.status,
      });
      return providerResult(
        "openai",
        "OpenAI",
        "organization.costs",
        "unavailable",
        `OpenAI billing endpoint returned ${response.status}.`,
        null
      );
    }

    const parsed = parseOpenAiMonthlyCost(payload);
    if (parsed.monthlyCostUsd === null) {
      return providerResult(
        "openai",
        "OpenAI",
        "organization.costs",
        "unavailable",
        "OpenAI billing response did not include cost buckets.",
        null
      );
    }

    return providerResult(
      "openai",
      "OpenAI",
      "organization.costs",
      "live",
      "Live month-to-date billing pulled from OpenAI.",
      parsed.monthlyCostUsd,
      parsed.currency || "USD"
    );
  } catch (error) {
    args.log.warn("billing.openai.error", {
      provider: "openai",
      message: error instanceof Error ? error.message : String(error),
    });
    return providerResult(
      "openai",
      "OpenAI",
      "organization.costs",
      "error",
      "OpenAI billing request failed.",
      null
    );
  }
}

async function pullTwilioCost(args: {
  uid: string;
  log: Logger;
  fetchImpl: typeof fetch;
}): Promise<ControlPlaneBillingProviderSnapshot> {
  const [sid, token] = await Promise.all([
    resolveSecret(args.uid, "twilioSid", "TWILIO_ACCOUNT_SID"),
    resolveSecret(args.uid, "twilioToken", "TWILIO_AUTH_TOKEN"),
  ]);
  if (!sid || !token) {
    return providerResult(
      "twilio",
      "Twilio",
      "usage.records.this_month",
      "missing_credentials",
      "Missing Twilio SID/token for billing pull.",
      null
    );
  }

  const url = new URL(`${TWILIO_USAGE_URL}/${sid}/Usage/Records/ThisMonth.json`);
  url.searchParams.set("Category", "totalprice");
  url.searchParams.set("PageSize", "50");
  const basicAuth = Buffer.from(`${sid}:${token}`).toString("base64");

  args.log.info("billing.twilio.requested", {
    provider: "twilio",
    accountSid: sid.slice(-6),
  });

  try {
    const response = await fetchWithTimeout(args.fetchImpl, url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });
    const payload = await safeJson(response);

    if (response.status === 401 || response.status === 403) {
      return providerResult(
        "twilio",
        "Twilio",
        "usage.records.this_month",
        "unauthorized",
        "Twilio billing endpoint rejected SID/token.",
        null
      );
    }

    if (!response.ok) {
      args.log.warn("billing.twilio.failed", {
        provider: "twilio",
        status: response.status,
      });
      return providerResult(
        "twilio",
        "Twilio",
        "usage.records.this_month",
        "unavailable",
        `Twilio billing endpoint returned ${response.status}.`,
        null
      );
    }

    const parsed = parseTwilioMonthlyCost(payload);
    if (parsed.monthlyCostUsd === null) {
      return providerResult(
        "twilio",
        "Twilio",
        "usage.records.this_month",
        "unavailable",
        "Twilio usage response did not include price records.",
        null
      );
    }

    return providerResult(
      "twilio",
      "Twilio",
      "usage.records.this_month",
      "live",
      "Live month-to-date usage pulled from Twilio.",
      parsed.monthlyCostUsd,
      parsed.currency || "USD"
    );
  } catch (error) {
    args.log.warn("billing.twilio.error", {
      provider: "twilio",
      message: error instanceof Error ? error.message : String(error),
    });
    return providerResult(
      "twilio",
      "Twilio",
      "usage.records.this_month",
      "error",
      "Twilio billing request failed.",
      null
    );
  }
}

async function pullElevenLabsCost(args: {
  uid: string;
  window: ProviderWindow;
  log: Logger;
  fetchImpl: typeof fetch;
}): Promise<ControlPlaneBillingProviderSnapshot> {
  const key = await resolveSecret(args.uid, "elevenLabsKey", "ELEVENLABS_API_KEY");
  if (!key) {
    return providerResult(
      "elevenlabs",
      "ElevenLabs",
      "user.subscription",
      "missing_credentials",
      "Missing ElevenLabs API key for billing pull.",
      null
    );
  }

  args.log.info("billing.elevenlabs.requested", {
    provider: "elevenlabs",
    startIso: args.window.startIso,
    endIso: args.window.endIso,
  });

  try {
    const subscriptionResponse = await fetchWithTimeout(args.fetchImpl, ELEVENLABS_SUBSCRIPTION_URL, {
      method: "GET",
      headers: {
        "xi-api-key": key,
      },
    });
    const subscriptionPayload = await safeJson(subscriptionResponse);

    if (subscriptionResponse.status === 401 || subscriptionResponse.status === 403) {
      return providerResult(
        "elevenlabs",
        "ElevenLabs",
        "user.subscription",
        "unauthorized",
        "ElevenLabs billing endpoint rejected API key.",
        null
      );
    }

    if (!subscriptionResponse.ok) {
      args.log.warn("billing.elevenlabs.failed", {
        provider: "elevenlabs",
        status: subscriptionResponse.status,
      });
      return providerResult(
        "elevenlabs",
        "ElevenLabs",
        "user.subscription",
        "unavailable",
        `ElevenLabs subscription endpoint returned ${subscriptionResponse.status}.`,
        null
      );
    }

    const subscriptionCost = parseElevenLabsInvoiceCost(subscriptionPayload);
    if (subscriptionCost.monthlyCostUsd !== null) {
      return providerResult(
        "elevenlabs",
        "ElevenLabs",
        "user.subscription",
        "live",
        "Live invoice amount pulled from ElevenLabs subscription endpoint.",
        subscriptionCost.monthlyCostUsd,
        subscriptionCost.currency || "USD"
      );
    }

    const usageUrl = new URL(ELEVENLABS_USAGE_URL);
    usageUrl.searchParams.set("start_unix", String(args.window.startUnix));
    usageUrl.searchParams.set("end_unix", String(args.window.endUnix));

    const usageResponse = await fetchWithTimeout(args.fetchImpl, usageUrl.toString(), {
      method: "GET",
      headers: {
        "xi-api-key": key,
      },
    });
    const usagePayload = await safeJson(usageResponse);
    if (!usageResponse.ok) {
      return providerResult(
        "elevenlabs",
        "ElevenLabs",
        "usage.character-stats",
        "unavailable",
        "ElevenLabs usage endpoint did not return billable totals.",
        null
      );
    }

    const usageCost = parseElevenLabsUsageCost(usagePayload);
    if (usageCost.monthlyCostUsd === null) {
      return providerResult(
        "elevenlabs",
        "ElevenLabs",
        "usage.character-stats",
        "unavailable",
        "ElevenLabs usage payload did not include cost totals.",
        null
      );
    }

    return providerResult(
      "elevenlabs",
      "ElevenLabs",
      "usage.character-stats",
      "live",
      "Live month-to-date usage pulled from ElevenLabs.",
      usageCost.monthlyCostUsd,
      usageCost.currency || subscriptionCost.currency || "USD"
    );
  } catch (error) {
    args.log.warn("billing.elevenlabs.error", {
      provider: "elevenlabs",
      message: error instanceof Error ? error.message : String(error),
    });
    return providerResult(
      "elevenlabs",
      "ElevenLabs",
      "user.subscription",
      "error",
      "ElevenLabs billing request failed.",
      null
    );
  }
}

function providerException(
  providerId: ControlPlaneBillingProviderId,
  label: string,
  source: string,
  error: unknown
): ControlPlaneBillingProviderSnapshot {
  return providerResult(
    providerId,
    label,
    source,
    "error",
    error instanceof Error ? error.message : String(error),
    null
  );
}

export async function pullProviderBilling(input: PullProviderBillingInput): Promise<ControlPlaneBillingInput> {
  const cacheTtlMs = readCacheTtlMs();
  const now = input.now || new Date();
  const nowMs = now.getTime();
  const fetchImpl = input.fetchImpl || fetch;
  const window = currentMonthWindow(now);
  const cacheKey = input.uid;

  if (!input.bypassCache) {
    const cached = billingCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      input.log.info("billing.cache.hit", { ttlMs: cacheTtlMs });
      return cached.snapshot;
    }

    const inFlight = billingInFlight.get(cacheKey);
    if (inFlight) {
      input.log.info("billing.cache.inflight", { ttlMs: cacheTtlMs });
      return inFlight;
    }
  }

  const loadSnapshot = async (): Promise<ControlPlaneBillingInput> => {
    const [openai, twilio, elevenlabs] = await Promise.all([
      pullOpenAiCost({
        uid: input.uid,
        window,
        log: input.log,
        fetchImpl,
      }).catch((error) => providerException("openai", "OpenAI", "organization.costs", error)),
      pullTwilioCost({
        uid: input.uid,
        log: input.log,
        fetchImpl,
      }).catch((error) => providerException("twilio", "Twilio", "usage.records.this_month", error)),
      pullElevenLabsCost({
        uid: input.uid,
        window,
        log: input.log,
        fetchImpl,
      }).catch((error) => providerException("elevenlabs", "ElevenLabs", "user.subscription", error)),
    ]);

    return {
      capturedAt: now.toISOString(),
      providers: [openai, twilio, elevenlabs],
    };
  };

  if (input.bypassCache) {
    return loadSnapshot();
  }

  const pending = loadSnapshot()
    .then((snapshot) => {
      billingCache.set(cacheKey, {
        snapshot,
        expiresAtMs: nowMs + cacheTtlMs,
      });
      return snapshot;
    })
    .finally(() => {
      billingInFlight.delete(cacheKey);
    });

  billingInFlight.set(cacheKey, pending);
  return pending;
}
