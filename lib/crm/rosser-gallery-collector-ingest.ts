import "server-only";

import { createHash, createHmac } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import type { RosserGalleryCrmConfig } from "@/lib/crm/rosser-gallery-crm-config";
import {
  assertRosserGalleryCollectorLeadTimestampBounds,
  offerCodeForCollectorInterest,
  type RosserGalleryCollectorInterest,
  type RosserGalleryCollectorLeadV1,
} from "@/lib/crm/rosser-gallery-collector-contract";
import { getAdminDb } from "@/lib/firebase-admin";

const SOURCE = "rosser_gallery_collector_request";

interface DocumentSnapshotLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

interface DocumentReferenceLike {
  id: string;
  get(): Promise<DocumentSnapshotLike>;
}

interface QueryDocumentSnapshotLike extends DocumentSnapshotLike {
  id: string;
}

interface QuerySnapshotLike {
  docs: QueryDocumentSnapshotLike[];
}

interface QueryLike {
  limit(value: number): QueryLike;
  get(): Promise<QuerySnapshotLike>;
}

interface TransactionLike {
  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  set(
    reference: DocumentReferenceLike,
    data: Record<string, unknown>,
    options?: { merge: boolean }
  ): TransactionLike;
}

export interface CrmIngestStore {
  collection(name: string): {
    doc(id: string): DocumentReferenceLike;
    where(field: string, operator: "==", value: unknown): QueryLike;
  };
  runTransaction<T>(operation: (transaction: TransactionLike) => Promise<T>): Promise<T>;
}

export interface RosserGalleryCollectorIngestResult {
  replayed: boolean;
  latestApplied: boolean;
  receiptId: string;
  customerId: string;
  timelineEventId: string;
  receivedAt: string;
  sourceOfTruth: "firestore_projected";
}

export interface RosserGalleryCollectorIngestDependencies {
  correlationId: string;
  db?: CrmIngestStore;
  now?: () => Date;
  serverTimestamp?: () => unknown;
  dailyCreateLimit?: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function payloadFingerprint(payload: RosserGalleryCollectorLeadV1): string {
  return sha256(JSON.stringify(canonicalize(payload)));
}

function stableDocumentId(prefix: string, seed: string): string {
  return `${prefix}_${sha256(seed).slice(0, 40)}`;
}

function temporalMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const toDate = (value as { toDate?: () => Date }).toDate;
    if (typeof toDate === "function") {
      try {
        return toDate.call(value).getTime();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nextActionForInterest(interest: RosserGalleryCollectorInterest): string {
  if (interest === "commission") return "review_commission_request";
  if (interest === "private-viewing") return "schedule_private_viewing";
  if (interest === "mini") return "send_mini_availability";
  return "send_collector_preview";
}

export function stableRosserGalleryCustomerId(
  normalizedEmail: string,
  workspaceId: string,
  secret: string
): string {
  const digest = createHmac("sha256", secret)
    .update(`${workspaceId}:${normalizedEmail.trim().toLowerCase()}`, "utf8")
    .digest("hex");
  return `rng_customer_${digest.slice(0, 40)}`;
}

function stableContactIdentityId(
  normalizedEmail: string,
  workspaceId: string,
  secret: string
): string {
  const digest = createHmac("sha256", secret)
    .update(`${workspaceId}:${normalizedEmail.trim().toLowerCase()}`, "utf8")
    .digest("hex");
  return `rng_contact_${digest.slice(0, 40)}`;
}

function readContactIdentityCustomerId(
  identity: Record<string, unknown>,
  config: RosserGalleryCrmConfig
): string {
  if (
    identity.ownerUid !== config.ownerUid ||
    identity.workspaceId !== config.workspaceId ||
    identity.businessUnit !== config.businessUnit
  ) {
    throw new ApiError(409, "CRM contact identity is bound to a different route");
  }
  if (typeof identity.customerId !== "string" || !identity.customerId.trim()) {
    throw new ApiError(500, "Invalid CRM contact identity state");
  }
  return identity.customerId;
}

async function resolveBootstrapCustomerId(
  db: CrmIngestStore,
  normalizedEmail: string,
  deterministicCustomerId: string,
  config: RosserGalleryCrmConfig
): Promise<string> {
  const snapshot = await db
    .collection("leads")
    .where("userId", "==", config.ownerUid)
    .get();

  const matchingIds = snapshot.docs
    .filter((document) => {
      const row = document.data() || {};
      const email =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : null;
      const workspaceId =
        typeof row.workspaceId === "string" ? row.workspaceId.trim() : null;
      return (
        email === normalizedEmail.trim().toLowerCase() &&
        (!workspaceId || workspaceId === config.workspaceId)
      );
    })
    .map((document) => document.id)
    .sort((left, right) => left.localeCompare(right));

  if (matchingIds.includes(deterministicCustomerId)) {
    return deterministicCustomerId;
  }
  if (matchingIds.length > 1) {
    throw new ApiError(409, "Multiple CRM customers match this contact identity");
  }
  return matchingIds[0] || deterministicCustomerId;
}

function readReceiptResult(
  receiptId: string,
  receipt: Record<string, unknown>,
  expectedFingerprint: string,
  config: RosserGalleryCrmConfig
): RosserGalleryCollectorIngestResult {
  if (receipt.payloadFingerprint !== expectedFingerprint) {
    throw new ApiError(409, "Idempotency key was already used with a different payload");
  }
  if (
    receipt.ownerUid !== config.ownerUid ||
    receipt.workspaceId !== config.workspaceId ||
    receipt.businessUnit !== config.businessUnit
  ) {
    throw new ApiError(409, "Idempotency key is bound to a different CRM route");
  }

  const customerId = receipt.customerId;
  const timelineEventId = receipt.timelineEventId;
  const receivedAt = receipt.receivedAt;
  const latestApplied = receipt.latestApplied;
  if (
    typeof customerId !== "string" ||
    typeof timelineEventId !== "string" ||
    typeof receivedAt !== "string" ||
    typeof latestApplied !== "boolean"
  ) {
    throw new ApiError(500, "Invalid CRM ingest receipt state");
  }

  return {
    replayed: true,
    latestApplied,
    receiptId,
    customerId,
    timelineEventId,
    receivedAt,
    sourceOfTruth: "firestore_projected",
  };
}

export async function ingestRosserGalleryCollectorLead(
  payload: RosserGalleryCollectorLeadV1,
  config: RosserGalleryCrmConfig,
  dependencies: RosserGalleryCollectorIngestDependencies
): Promise<RosserGalleryCollectorIngestResult> {
  const db =
    dependencies.db || (getAdminDb() as unknown as CrmIngestStore);
  const now = dependencies.now || (() => new Date());
  const serverTimestamp = dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const dailyCreateLimit = dependencies.dailyCreateLimit || 500;
  const receivedAtDate = now();

  const fingerprint = payloadFingerprint(payload);
  const receiptId = stableDocumentId(
    "rng_receipt",
    `${SOURCE}:${payload.externalEventId}`
  );
  const timelineEventId = stableDocumentId(
    "rng_activity",
    `${SOURCE}:${payload.externalEventId}`
  );
  const consentEventId = stableDocumentId(
    "rng_consent",
    `${SOURCE}:${payload.externalEventId}`
  );
  const deterministicCustomerId = stableRosserGalleryCustomerId(
    payload.contact.email,
    config.workspaceId,
    config.customerIdHmacSecret
  );
  const contactIdentityId = stableContactIdentityId(
    payload.contact.email,
    config.workspaceId,
    config.customerIdHmacSecret
  );
  const receiptRef = db.collection("crm_ingest_receipts").doc(receiptId);
  const contactIdentityRef = db
    .collection("crm_contact_identities")
    .doc(contactIdentityId);
  const rateLimitRef = db.collection("crm_ingest_rate_limits").doc(
    stableDocumentId(
      "rng_daily",
      `${config.ownerUid}:${config.workspaceId}:${receivedAtDate.toISOString().slice(0, 10)}`
    )
  );

  const [preflightReceipt, preflightIdentity] = await Promise.all([
    receiptRef.get(),
    contactIdentityRef.get(),
  ]);
  if (preflightReceipt.exists) {
    return readReceiptResult(
      receiptId,
      preflightReceipt.data() || {},
      fingerprint,
      config
    );
  }
  assertRosserGalleryCollectorLeadTimestampBounds(payload, receivedAtDate);

  const bootstrapCustomerId = preflightIdentity.exists
    ? readContactIdentityCustomerId(preflightIdentity.data() || {}, config)
    : await resolveBootstrapCustomerId(
        db,
        payload.contact.email,
        deterministicCustomerId,
        config
      );
  const receivedAt = receivedAtDate.toISOString();

  return db.runTransaction(async (transaction) => {
    const timelineRef = db.collection("activities").doc(timelineEventId);
    const consentRef = db.collection("crm_consent_events").doc(consentEventId);

    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists) {
      return readReceiptResult(
        receiptId,
        receiptSnapshot.data() || {},
        fingerprint,
        config
      );
    }

    const identitySnapshot = await transaction.get(contactIdentityRef);
    const customerId = identitySnapshot.exists
      ? readContactIdentityCustomerId(identitySnapshot.data() || {}, config)
      : bootstrapCustomerId;
    const customerRef = db.collection("leads").doc(customerId);
    const customerSnapshot = await transaction.get(customerRef);
    const rateLimitSnapshot = await transaction.get(rateLimitRef);
    const rateLimitRow = rateLimitSnapshot.data() || {};
    const createCount =
      typeof rateLimitRow.createCount === "number" &&
      Number.isFinite(rateLimitRow.createCount)
        ? Math.max(0, Math.floor(rateLimitRow.createCount))
        : 0;
    if (createCount >= dailyCreateLimit) {
      throw new ApiError(429, "Rosser Gallery CRM daily ingest limit reached");
    }

    const existingCustomer = customerSnapshot.data() || {};
    const existingConsentScopes = asRecord(existingCustomer.consentScopes);
    const existingGalleryConsent = asRecord(
      existingConsentScopes.rosser_gallery_collector
    );
    const existingMarketingConsent = existingGalleryConsent.marketingEmail === true;
    const effectiveMarketingConsent = existingMarketingConsent || payload.permissions.marketingEmail;
    const existingConsentedAt = existingGalleryConsent.marketingConsentedAt || null;
    const existingConsentVersion = existingGalleryConsent.marketingConsentVersion || null;
    const incomingConsentMillis = temporalMillis(payload.permissions.consentedAt);
    const existingConsentMillis = temporalMillis(existingConsentedAt);
    const incomingConsentIsNewest =
      payload.permissions.marketingEmail &&
      (existingConsentMillis === null ||
        (incomingConsentMillis !== null && incomingConsentMillis >= existingConsentMillis));
    const effectiveConsentedAt = incomingConsentIsNewest
      ? payload.permissions.consentedAt
      : existingConsentedAt;
    const effectiveConsentVersion = incomingConsentIsNewest
      ? payload.permissions.consentVersion
      : existingConsentVersion;
    const existingBusinessUnit =
      typeof existingCustomer.businessUnit === "string"
        ? existingCustomer.businessUnit
        : null;
    const existingBusinessUnits = Array.isArray(existingCustomer.businessUnits)
      ? existingCustomer.businessUnits.filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      : [];
    const businessUnits = Array.from(
      new Set([
        ...(existingBusinessUnit ? [existingBusinessUnit] : []),
        ...existingBusinessUnits,
        config.businessUnit,
      ])
    );
    const offerCode = offerCodeForCollectorInterest(payload.collector.interest);
    const timestamp = serverTimestamp();
    const existingLastInquiryMillis = temporalMillis(existingCustomer.lastInquiryAt);
    const incomingInquiryMillis = temporalMillis(payload.capturedAt);
    const isLatestInquiry =
      !customerSnapshot.exists ||
      existingLastInquiryMillis === null ||
      (incomingInquiryMillis !== null && incomingInquiryMillis >= existingLastInquiryMillis);

    const customerWrite: Record<string, unknown> = {
      companyName:
        typeof existingCustomer.companyName === "string" && existingCustomer.companyName.trim()
          ? existingCustomer.companyName
          : payload.contact.name,
      email: payload.contact.email,
      normalizedEmail: payload.contact.email,
      sourceOfTruth: "firestore_projected",
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      owner: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnits,
      consentScopes: {
        ...existingConsentScopes,
        rosser_gallery_collector: {
          ...existingGalleryConsent,
          responseEmail: true,
          marketingEmail: effectiveMarketingConsent,
          marketingConsentedAt: effectiveConsentedAt,
          marketingConsentVersion: effectiveConsentVersion,
          sms: false,
          rtSolutions: false,
        },
      },
      dncProtection: true,
      duplicateProtection: true,
      timelineCount:
        (typeof existingCustomer.timelineCount === "number" &&
        Number.isFinite(existingCustomer.timelineCount)
          ? Math.max(0, Math.floor(existingCustomer.timelineCount))
          : 0) + 1,
      updatedAt: timestamp,
    };

    if (isLatestInquiry) {
      Object.assign(customerWrite, {
        contactName: payload.contact.name,
        latestContactName: payload.contact.name,
        latestSource: "Rosser Gallery collector request",
        latestSourceSystem: "rngwebsite",
        sourceEventId: payload.externalEventId,
        latestBusinessUnit: config.businessUnit,
        latestRoute: "rng",
        latestOfferCode: offerCode,
        latestCampaign: payload.campaign,
        collectorProfile: {
          city: payload.collector.city,
          interest: payload.collector.interest,
        },
        latestSubmissionPermissions: payload.permissions,
        lastInquiryAt: payload.capturedAt,
        latestTimelineAt: payload.capturedAt,
        lastTouch: payload.campaign.lastTouch,
        next_action: nextActionForInterest(payload.collector.interest),
        correlationId: dependencies.correlationId,
      });
      if (
        existingCustomer.recordType === "individual_collector" ||
        typeof existingCustomer.founderName !== "string" ||
        !existingCustomer.founderName.trim()
      ) {
        customerWrite.founderName = payload.contact.name;
      }
    }

    if (
      isLatestInquiry &&
      (!existingBusinessUnit || existingBusinessUnit === config.businessUnit)
    ) {
      customerWrite.offerCode = offerCode;
    }

    if (!customerSnapshot.exists) {
      Object.assign(customerWrite, {
        founderName: payload.contact.name,
        phone: null,
        recordType: "individual_collector",
        source: "Rosser Gallery collector request",
        sourceSystem: "rngwebsite",
        businessUnit: config.businessUnit,
        route: "rng",
        pipelineStage: "lead_capture",
        status: "new",
        firstTouch: payload.campaign.firstTouch,
        acquisitionCampaign: payload.campaign,
        createdAt: timestamp,
      });
    }

    transaction.set(
      contactIdentityRef,
      {
        schemaVersion: 1,
        ownerUid: config.ownerUid,
        workspaceId: config.workspaceId,
        businessUnit: config.businessUnit,
        customerId,
        correlationId: dependencies.correlationId,
        updatedAt: timestamp,
        ...(identitySnapshot.exists ? {} : { createdAt: timestamp }),
      },
      { merge: true }
    );
    transaction.set(rateLimitRef, {
      schemaVersion: 1,
      ownerUid: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: config.businessUnit,
      createCount: createCount + 1,
      limit: dailyCreateLimit,
      date: receivedAt.slice(0, 10),
      updatedAt: timestamp,
      ...(rateLimitSnapshot.exists ? {} : { createdAt: timestamp }),
    }, { merge: true });
    transaction.set(customerRef, customerWrite, { merge: true });
    transaction.set(timelineRef, {
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      owner: config.ownerUid,
      workspaceId: config.workspaceId,
      customerId,
      externalEventId: payload.externalEventId,
      action: "crm.collector_inquiry_received",
      type: "system",
      summary: "Collector request received for The Braider.",
      details: payload.collector.note || null,
      collector: {
        city: payload.collector.city,
        interest: payload.collector.interest,
      },
      permissions: payload.permissions,
      campaign: payload.campaign,
      next_action: nextActionForInterest(payload.collector.interest),
      correlationId: dependencies.correlationId,
      timestamp: payload.capturedAt,
      ingestedAt: timestamp,
      source: SOURCE,
      sourceOfTruth: "firestore_projected",
    });
    transaction.set(consentRef, {
      schemaVersion: 1,
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      owner: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: config.businessUnit,
      customerId,
      externalEventId: payload.externalEventId,
      grants: [
        "rosser_gallery.inquiry_response",
        ...(payload.permissions.marketingEmail
          ? ["rosser_gallery.marketing_email"]
          : []),
      ],
      consentVersion: payload.permissions.consentVersion,
      consentedAt: payload.permissions.consentedAt,
      submittedAt: payload.capturedAt,
      correlationId: dependencies.correlationId,
      source: SOURCE,
      createdAt: timestamp,
    });
    transaction.set(receiptRef, {
      schemaVersion: 1,
      source: SOURCE,
      externalEventId: payload.externalEventId,
      payloadFingerprint: fingerprint,
      ownerUid: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: config.businessUnit,
      customerId,
      timelineEventId,
      latestApplied: isLatestInquiry,
      correlationId: dependencies.correlationId,
      receivedAt,
      createdAt: timestamp,
    });

    return {
      replayed: false,
      latestApplied: isLatestInquiry,
      receiptId,
      customerId,
      timelineEventId,
      receivedAt,
      sourceOfTruth: "firestore_projected" as const,
    };
  });
}
