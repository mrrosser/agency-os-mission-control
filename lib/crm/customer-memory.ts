import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import { getAdminDb } from "@/lib/firebase-admin";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import {
  DEFAULT_OFFER_CODE_BY_BUSINESS,
  formatCrmPipelineStageLabel,
  legacyStatusFromPipelineStage,
  normalizeBusinessUnit,
  normalizeCrmPipelineStage,
  normalizeOfferCode,
  resolveOfferCodeForBusinessUnit,
  type BusinessUnitId,
  type CrmPipelineStage,
} from "@/lib/revenue/offers";

export type CustomerMemorySource = "paperclip" | "firestore_projected";
export type CustomerTimelineChannel =
  | "email"
  | "sms"
  | "voice"
  | "calendar"
  | "social"
  | "pos"
  | "ads"
  | "system";

export interface CustomerRecord {
  customerId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  sourceLabel: string | null;
  businessUnit: BusinessUnitId;
  offerCode: string;
  pipelineStage: CrmPipelineStage;
  channels: CustomerTimelineChannel[];
  lastTimelineAt: string | null;
  timelineCount: number;
  duplicateProtection: boolean;
  dncProtection: boolean;
  sourceOfTruth: CustomerMemorySource;
}

export interface CustomerTimelineEvent {
  eventId: string;
  customerId: string;
  type: string;
  channel: CustomerTimelineChannel;
  summary: string;
  detail: string | null;
  occurredAt: string | null;
  sourceOfTruth: CustomerMemorySource;
  metadata?: Record<string, unknown>;
}

export interface CustomerUpsertInput {
  customerId?: string | null;
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceLabel?: string | null;
  businessUnit?: unknown;
  offerCode?: unknown;
  pipelineStage?: unknown;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const record = value as { toDate?: () => Date };
  if (typeof record?.toDate === "function") {
    try {
      return record.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function detectChannel(value: unknown): CustomerTimelineChannel | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("sms") || normalized.includes("text")) return "sms";
  if (normalized.includes("voice") || normalized.includes("call")) return "voice";
  if (normalized.includes("calendar") || normalized.includes("meeting")) return "calendar";
  if (normalized.includes("social")) return "social";
  if (normalized.includes("pos") || normalized.includes("square") || normalized.includes("payment")) {
    return "pos";
  }
  if (normalized.includes("ad")) return "ads";
  if (normalized.includes("mail") || normalized.includes("email") || normalized.includes("gmail")) {
    return "email";
  }
  return normalized === "system" ? "system" : null;
}

function detectChannelsFromRecord(record: {
  email?: string | null;
  phone?: string | null;
  channels?: unknown[];
}): CustomerTimelineChannel[] {
  const channels = new Set<CustomerTimelineChannel>();
  for (const value of asArray(record.channels)) {
    const channel = detectChannel(value);
    if (channel) channels.add(channel);
  }
  if (record.email) channels.add("email");
  if (record.phone) {
    channels.add("sms");
    channels.add("voice");
  }
  channels.add("system");
  return Array.from(channels);
}

function extractItems(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of keys) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate;
    const nested = asRecord(candidate);
    if (!nested) continue;
    for (const nestedKey of keys) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

function newestIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > bestMs) {
      bestMs = parsed;
      best = value;
    }
  }
  return best;
}

export function normalizePaperclipCustomers(payload: unknown): CustomerRecord[] {
  const items = extractItems(payload, ["customers", "items", "data", "results"]);
  const customers: CustomerRecord[] = [];
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const businessUnit = normalizeBusinessUnit(row.businessUnit);
    const offerCode =
      normalizeOfferCode(row.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];
    const customerId = asString(row.customerId) || asString(row.id) || asString(row.leadId);
    const companyName =
      asString(row.companyName) || asString(row.company) || asString(row.accountName) || asString(row.name);
    if (!customerId || !companyName) continue;

    const email = asString(row.email) || asString(row.primaryEmail);
    const phone = asString(row.phone) || asString(row.primaryPhone);
    const lastTimelineAt = newestIso([
      toIso(row.lastTimelineAt),
      toIso(row.updatedAt),
      toIso(row.createdAt),
    ]);

    customers.push({
      customerId,
      companyName,
      contactName: asString(row.contactName) || asString(row.founderName),
      email,
      phone,
      sourceLabel: asString(row.source) || asString(row.sourceLabel),
      businessUnit,
      offerCode,
      pipelineStage: normalizeCrmPipelineStage(row.pipelineStage || row.status),
      channels: detectChannelsFromRecord({
        email,
        phone,
        channels: asArray(row.channels),
      }),
      lastTimelineAt,
      timelineCount: asNumber(row.timelineCount || row.eventCount || row.recentTimelineEvents),
      duplicateProtection: row.duplicateProtection !== false,
      dncProtection: row.dncProtection !== false,
      sourceOfTruth: "paperclip",
    });
  }

  return customers.sort((left, right) => {
    const leftMs = Date.parse(left.lastTimelineAt || "") || 0;
    const rightMs = Date.parse(right.lastTimelineAt || "") || 0;
    return rightMs - leftMs;
  });
}

export function normalizePaperclipTimeline(
  customerId: string,
  payload: unknown
): CustomerTimelineEvent[] {
  const items = extractItems(payload, ["timeline", "events", "items", "data", "results"]);
  const events: CustomerTimelineEvent[] = [];
  items.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;
    const occurredAt = newestIso([
      toIso(row.occurredAt),
      toIso(row.timestamp),
      toIso(row.createdAt),
      toIso(row.updatedAt),
    ]);
    const summary =
      asString(row.summary) || asString(row.title) || asString(row.message) || asString(row.type);
    if (!summary) return;
    const channel =
      detectChannel(row.channel) || detectChannel(row.type) || detectChannel(row.action) || "system";
    events.push({
      eventId: asString(row.eventId) || asString(row.id) || `${customerId}:paperclip:${index}`,
      customerId,
      type: asString(row.type) || asString(row.action) || "event",
      channel,
      summary,
      detail: asString(row.detail) || asString(row.description) || asString(row.note),
      occurredAt,
      sourceOfTruth: "paperclip",
      metadata: asRecord(row.metadata) || asRecord(row.data) || undefined,
    });
  });

  return events.sort((left, right) => {
    const leftMs = Date.parse(left.occurredAt || "") || 0;
    const rightMs = Date.parse(right.occurredAt || "") || 0;
    return rightMs - leftMs;
  });
}

export async function listProjectedCustomers(
  uid: string,
  log: Logger,
  limit: number = 100
): Promise<CustomerRecord[]> {
  try {
    const [leadSnap, activitySnap] = await Promise.all([
      getAdminDb().collection("leads").where("userId", "==", uid).limit(Math.max(1, limit)).get(),
      getAdminDb().collection("activities").where("userId", "==", uid).limit(200).get(),
    ]);

    const activityStats = new Map<string, { count: number; lastAt: string | null }>();
    for (const doc of activitySnap.docs) {
      const row = doc.data() as Record<string, unknown>;
      const customerId = asString(row.customerId);
      if (!customerId) continue;
      const existing = activityStats.get(customerId) || { count: 0, lastAt: null };
      const occurredAt = newestIso([toIso(row.timestamp), existing.lastAt]);
      activityStats.set(customerId, {
        count: existing.count + 1,
        lastAt: occurredAt,
      });
    }

    return leadSnap.docs
      .map((doc) => {
        const row = doc.data() as Record<string, unknown>;
        const businessUnit = normalizeBusinessUnit(row.businessUnit);
        const offerCode =
          normalizeOfferCode(row.offerCode) || DEFAULT_OFFER_CODE_BY_BUSINESS[businessUnit];
        const email = asString(row.email);
        const phone = asString(row.phone);
        const stats = activityStats.get(doc.id);
        const lastTimelineAt = newestIso([
          stats?.lastAt || null,
          toIso(row.updatedAt),
          toIso(row.createdAt),
        ]);
        return {
          customerId: doc.id,
          companyName:
            asString(row.companyName) || asString(row.company) || asString(row.name) || "Untitled Lead",
          contactName: asString(row.founderName) || asString(row.name),
          email,
          phone,
          sourceLabel: asString(row.source),
          businessUnit,
          offerCode,
          pipelineStage: normalizeCrmPipelineStage(row.pipelineStage || row.status),
          channels: detectChannelsFromRecord({
            email,
            phone,
          }),
          lastTimelineAt,
          timelineCount: (stats?.count || 0) + 1,
          duplicateProtection: true,
          dncProtection: true,
          sourceOfTruth: "firestore_projected" as const,
        } satisfies CustomerRecord;
      })
      .sort((left, right) => {
        const leftMs = Date.parse(left.lastTimelineAt || "") || 0;
        const rightMs = Date.parse(right.lastTimelineAt || "") || 0;
        return rightMs - leftMs;
      });
  } catch (error) {
    log.warn("crm.projected_customers_unavailable", {
      uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function getProjectedCustomerTimeline(
  uid: string,
  customerId: string,
  log: Logger
): Promise<CustomerTimelineEvent[]> {
  try {
    const [leadSnap, activitySnap] = await Promise.all([
      getAdminDb().collection("leads").doc(customerId).get(),
      getAdminDb().collection("activities").where("userId", "==", uid).limit(200).get(),
    ]);

    if (!leadSnap.exists) return [];
    const lead = leadSnap.data() as Record<string, unknown>;
    if (asString(lead.userId) !== uid) return [];

    const leadCreatedAt = toIso(lead.createdAt);
    const leadUpdatedAt = toIso(lead.updatedAt);
    const baseEvents: CustomerTimelineEvent[] = [
      {
        eventId: `${customerId}:crm:created`,
        customerId,
        type: "crm.created",
        channel: "system",
        summary: "Customer record created in Mission Control CRM.",
        detail: null,
        occurredAt: leadCreatedAt,
        sourceOfTruth: "firestore_projected",
      },
      {
        eventId: `${customerId}:crm:stage`,
        customerId,
        type: "crm.stage",
        channel: "system",
        summary: `Pipeline stage: ${formatCrmPipelineStageLabel(
          normalizeCrmPipelineStage(lead.pipelineStage || lead.status)
        )}`,
        detail: normalizeOfferCode(lead.offerCode) || null,
        occurredAt: leadUpdatedAt || leadCreatedAt,
        sourceOfTruth: "firestore_projected",
      },
    ];

    const activityEvents: CustomerTimelineEvent[] = [];
    for (const doc of activitySnap.docs) {
      const row = doc.data() as Record<string, unknown>;
      if (asString(row.customerId) !== customerId) continue;
      const type = asString(row.type) || "system";
      activityEvents.push({
        eventId: doc.id,
        customerId,
        type: asString(row.action) || "activity",
        channel: detectChannel(type) || "system",
        summary:
          asString(row.summary) ||
          asString(row.action) ||
          asString(row.details) ||
          "Recorded activity",
        detail: asString(row.details),
        occurredAt: toIso(row.timestamp),
        sourceOfTruth: "firestore_projected",
      });
    }

    return [...baseEvents, ...activityEvents].sort((left, right) => {
      const leftMs = Date.parse(left.occurredAt || "") || 0;
      const rightMs = Date.parse(right.occurredAt || "") || 0;
      return rightMs - leftMs;
    });
  } catch (error) {
    log.warn("crm.projected_timeline_unavailable", {
      uid,
      customerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function upsertProjectedCustomer(
  uid: string,
  input: CustomerUpsertInput
): Promise<CustomerRecord> {
  const businessUnit = normalizeBusinessUnit(input.businessUnit);
  const offerResolution = resolveOfferCodeForBusinessUnit(businessUnit, input.offerCode);
  const pipelineStage = normalizeCrmPipelineStage(input.pipelineStage);
  const payload = stripUndefined({
    companyName: input.companyName.trim(),
    founderName: asString(input.contactName),
    email: asString(input.email),
    phone: asString(input.phone),
    source: asString(input.sourceLabel),
    userId: uid,
    businessUnit,
    offerCode: offerResolution.offerCode,
    pipelineStage,
    status: legacyStatusFromPipelineStage(pipelineStage),
    updatedAt: FieldValue.serverTimestamp(),
  }) as Record<string, unknown>;

  const customerId = asString(input.customerId);
  if (customerId) {
    await getAdminDb().collection("leads").doc(customerId).set(payload, { merge: true });
  } else {
    const ref = getAdminDb().collection("leads").doc();
    await ref.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      customerId: ref.id,
      companyName: input.companyName.trim(),
      contactName: asString(input.contactName),
      email: asString(input.email),
      phone: asString(input.phone),
      sourceLabel: asString(input.sourceLabel),
      businessUnit,
      offerCode: offerResolution.offerCode,
      pipelineStage,
      channels: detectChannelsFromRecord({
        email: asString(input.email),
        phone: asString(input.phone),
      }),
      lastTimelineAt: null,
      timelineCount: 1,
      duplicateProtection: true,
      dncProtection: true,
      sourceOfTruth: "firestore_projected",
    };
  }

  await recordProjectedTimelineEvent(uid, customerId, {
    action: "crm.upsert_customer",
    type: "lead",
    summary: "Customer record updated in Mission Control CRM.",
    details: input.companyName.trim(),
  });

  return {
    customerId,
    companyName: input.companyName.trim(),
    contactName: asString(input.contactName),
    email: asString(input.email),
    phone: asString(input.phone),
    sourceLabel: asString(input.sourceLabel),
    businessUnit,
    offerCode: offerResolution.offerCode,
    pipelineStage,
    channels: detectChannelsFromRecord({
      email: asString(input.email),
      phone: asString(input.phone),
    }),
    lastTimelineAt: null,
    timelineCount: 1,
    duplicateProtection: true,
    dncProtection: true,
    sourceOfTruth: "firestore_projected",
  };
}

export async function updateProjectedCustomerStage(
  uid: string,
  customerId: string,
  pipelineStageInput: unknown
): Promise<CustomerTimelineEvent> {
  const pipelineStage = normalizeCrmPipelineStage(pipelineStageInput);
  await getAdminDb().collection("leads").doc(customerId).set(
    {
      pipelineStage,
      status: legacyStatusFromPipelineStage(pipelineStage),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return recordProjectedTimelineEvent(uid, customerId, {
    action: "crm.update_stage",
    type: "system",
    summary: `Pipeline stage changed to ${formatCrmPipelineStageLabel(pipelineStage)}.`,
    details: pipelineStage,
  });
}

export async function recordProjectedTimelineEvent(
  uid: string,
  customerId: string,
  input: {
    action: string;
    type: string;
    summary: string;
    details?: string | null;
  }
): Promise<CustomerTimelineEvent> {
  const ref = await getAdminDb().collection("activities").add({
    userId: uid,
    customerId,
    action: input.action,
    type: input.type,
    summary: input.summary,
    details: input.details || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    eventId: ref.id,
    customerId,
    type: input.action,
    channel: detectChannel(input.type) || "system",
    summary: input.summary,
    detail: input.details || null,
    occurredAt: null,
    sourceOfTruth: "firestore_projected",
  };
}
