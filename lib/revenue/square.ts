import { createHmac, timingSafeEqual } from "crypto";
import { OFFER_DEFINITIONS, normalizeOfferCode } from "@/lib/revenue/offers";

const KNOWN_OFFER_CODES = OFFER_DEFINITIONS.map((offer) => offer.code);
const KNOWN_OFFER_SET = new Set(KNOWN_OFFER_CODES);
const DEFAULT_ALLOWLISTED_EVENT_PREFIXES = ["PAYMENT.", "INVOICE.", "REFUND.", "ORDER."] as const;

export type SquareEventCategory = "payment" | "invoice" | "refund" | "order" | "other";

export interface SquarePaymentSnapshot {
  paymentId: string | null;
  orderId: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  customerId: string | null;
  referenceId: string | null;
  note: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asUpper(value: unknown): string {
  return asString(value).toUpperCase();
}

function atPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const row = asObject(current);
    if (!row || !(segment in row)) return undefined;
    current = row[segment];
  }
  return current;
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 6 || output.length >= 120) return;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) output.push(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, output, depth + 1);
      if (output.length >= 120) return;
    }
    return;
  }
  const row = asObject(value);
  if (!row) return;
  for (const entry of Object.values(row)) {
    collectStrings(entry, output, depth + 1);
    if (output.length >= 120) return;
  }
}

function collectValuesForKey(
  value: unknown,
  matcher: RegExp,
  output: unknown[],
  depth = 0
): void {
  if (depth > 6 || output.length >= 120) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectValuesForKey(entry, matcher, output, depth + 1);
      if (output.length >= 120) return;
    }
    return;
  }

  const row = asObject(value);
  if (!row) return;
  for (const [key, entry] of Object.entries(row)) {
    if (matcher.test(key)) {
      output.push(entry);
      if (output.length >= 120) return;
    }
    collectValuesForKey(entry, matcher, output, depth + 1);
    if (output.length >= 120) return;
  }
}

function sanitizeLeadDocId(value: string): string | null {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!cleaned || cleaned.length < 4 || cleaned.length > 128) return null;
  return cleaned;
}

export function extractSquareEventType(payload: unknown): string | null {
  const primary = asUpper(atPath(payload, ["type"]));
  if (primary) return primary;
  const nested = asUpper(atPath(payload, ["event", "type"]));
  return nested || null;
}

export function classifySquareEventCategory(eventType: string | null | undefined): SquareEventCategory {
  const normalized = asUpper(eventType || "");
  if (!normalized) return "other";
  if (normalized.startsWith("PAYMENT.")) return "payment";
  if (normalized.startsWith("INVOICE.")) return "invoice";
  if (normalized.startsWith("REFUND.")) return "refund";
  if (normalized.startsWith("ORDER.")) return "order";
  return "other";
}

export function isSquareAllowlistedEventType(
  eventType: string | null | undefined,
  allowlistedPrefixes: readonly string[] = DEFAULT_ALLOWLISTED_EVENT_PREFIXES
): boolean {
  const normalized = asUpper(eventType || "");
  if (!normalized) return false;
  return allowlistedPrefixes.some((prefix) => normalized.startsWith(asUpper(prefix)));
}

export function computeSquareWebhookSignature(args: {
  notificationUrl: string;
  rawBody: string;
  signatureKey: string;
}): string {
  return createHmac("sha256", args.signatureKey)
    .update(`${args.notificationUrl}${args.rawBody}`)
    .digest("base64");
}

export function verifySquareWebhookSignature(args: {
  notificationUrl: string;
  rawBody: string;
  signatureKey: string;
  providedSignature: string | null | undefined;
}): boolean {
  const provided = asString(args.providedSignature || "");
  if (!provided) return false;

  const expected = computeSquareWebhookSignature({
    notificationUrl: args.notificationUrl,
    rawBody: args.rawBody,
    signatureKey: args.signatureKey,
  });

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function extractSquareEventId(payload: unknown): string | null {
  const eventId = asString(atPath(payload, ["event_id"])) || asString(atPath(payload, ["id"]));
  return eventId || null;
}

export function extractSquareOfferCode(payload: unknown): string | null {
  const directValues: unknown[] = [];
  collectValuesForKey(payload, /^offer[-_]?code$/i, directValues);
  for (const value of directValues) {
    const normalized = normalizeOfferCode(value);
    if (KNOWN_OFFER_SET.has(normalized)) return normalized;
  }

  const strings: string[] = [];
  collectStrings(payload, strings);
  for (const value of strings) {
    const upper = value.toUpperCase();
    for (const code of KNOWN_OFFER_CODES) {
      if (upper.includes(code)) return code;
    }
  }

  return null;
}

export function extractSquareLeadDocIdHint(payload: unknown): string | null {
  const directValues: unknown[] = [];
  collectValuesForKey(payload, /^(lead(doc)?[-_]?id|crm[-_]?lead[-_]?id)$/i, directValues);
  for (const value of directValues) {
    const hint = sanitizeLeadDocId(asString(value));
    if (hint) return hint;
  }

  const strings: string[] = [];
  collectStrings(payload, strings);
  for (const value of strings) {
    const match = value.match(/\blead(?:[_\s-]?doc)?(?:[_\s-]?id)?\s*[:=]\s*([A-Za-z0-9_-]{4,128})/i);
    if (!match) continue;
    const hint = sanitizeLeadDocId(match[1] || "");
    if (hint) return hint;
  }

  return null;
}

export function extractSquareUidHint(payload: unknown, fallbackUid?: string | null): string | null {
  const directValues: unknown[] = [];
  collectValuesForKey(payload, /^(uid|user[-_]?id|firebase[-_]?uid|owner[-_]?uid)$/i, directValues);
  for (const value of directValues) {
    const uid = asString(value);
    if (uid) return uid;
  }

  const fallback = asString(fallbackUid || "");
  return fallback || null;
}

export function extractSquarePaymentSnapshot(payload: unknown): SquarePaymentSnapshot {
  const payment =
    asObject(atPath(payload, ["data", "object", "payment"])) ||
    asObject(atPath(payload, ["payment"])) ||
    {};

  const order =
    asObject(atPath(payload, ["data", "object", "order"])) ||
    asObject(atPath(payload, ["order"])) ||
    {};

  const amountRow =
    asObject(payment.amount_money) ||
    asObject(payment.approved_money) ||
    asObject(order.total_money) ||
    {};

  const amountRaw = typeof amountRow.amount === "number" ? amountRow.amount : Number(amountRow.amount);
  const amountCents = Number.isFinite(amountRaw) ? Math.trunc(amountRaw) : null;

  return {
    paymentId: asString(payment.id) || null,
    orderId: asString(payment.order_id) || asString(order.id) || null,
    status: asString(payment.status) || asString(order.state) || null,
    amountCents,
    currency: asUpper(amountRow.currency) || null,
    customerId: asString(payment.customer_id) || null,
    referenceId: asString(payment.reference_id) || asString(order.reference_id) || null,
    note: asString(payment.note) || asString(order.note) || null,
  };
}

export function isSquareCompletedPaymentEvent(payload: unknown): boolean {
  const eventType = asUpper(atPath(payload, ["type"]));
  const snapshot = extractSquarePaymentSnapshot(payload);
  const status = asUpper(snapshot.status);

  if (status === "COMPLETED" || status === "PAID") return true;
  if (eventType.startsWith("PAYMENT.") && status === "APPROVED") return true;

  const orderState = asUpper(atPath(payload, ["data", "object", "order", "state"]));
  if (orderState === "COMPLETED" && eventType.startsWith("ORDER.")) return true;

  return false;
}
