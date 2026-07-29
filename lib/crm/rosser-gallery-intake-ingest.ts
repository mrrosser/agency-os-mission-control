import "server-only";

import { createHash, createHmac } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import {
  assertRosserGalleryIntakeTimestampBounds,
  type RosserGalleryIntakeLeadV1,
} from "@/lib/crm/rosser-gallery-intake-contract";
import {
  crmBusinessUnitForIntake,
  type RosserGalleryIntakeConfig,
} from "@/lib/crm/rosser-gallery-intake-config";
import {
  buildIntakeNotificationDrafts,
  type IntakeNotificationChannel,
} from "@/lib/crm/rosser-gallery-intake-notifications";
import {
  stableRosserGalleryCustomerId,
  type CrmIngestStore,
} from "@/lib/crm/rosser-gallery-collector-ingest";
import { getAdminDb } from "@/lib/firebase-admin";

interface IntakeProjection {
  source: string;
  sourceLabel: string;
  timelineAction: string;
  timelineSummary: string;
  nextAction: string;
  tags: string[];
}

export interface IntakeNotificationQueueResult {
  channel: IntakeNotificationChannel;
  outboxId: string;
  receiptId: string;
  status: "queued";
}

export interface RosserGalleryIntakeIngestResult {
  replayed: boolean;
  latestApplied: boolean;
  receiptId: string;
  customerId: string;
  timelineEventId: string;
  notificationChannels: IntakeNotificationQueueResult[];
  receivedAt: string;
  sourceOfTruth: "firestore_projected";
}

export interface RosserGalleryIntakeIngestDependencies {
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

function stableDocumentId(prefix: string, seed: string): string {
  return `${prefix}_${sha256(seed).slice(0, 40)}`;
}

function payloadFingerprint(payload: RosserGalleryIntakeLeadV1): string {
  return sha256(JSON.stringify(canonicalize(payload)));
}

function stableIntakeIdentityId(
  email: string,
  workspaceId: string,
  secret: string
): string {
  const digest = createHmac("sha256", secret)
    .update(`${workspaceId}:${email.trim().toLowerCase()}`, "utf8")
    .digest("hex");
  return `intake_contact_${digest.slice(0, 40)}`;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0
      )
    : [];
}

function projectionForIntake(
  payload: RosserGalleryIntakeLeadV1
): IntakeProjection {
  const businessTag =
    payload.businessUnit === "rosser_gallery"
      ? "gallery_intake"
      : "rt_solutions_intake";
  const laneTag = `${businessTag}_${payload.lane}`;
  const nextActions: Record<RosserGalleryIntakeLeadV1["lane"], string> = {
    artist_call: "review_artist_application",
    vendor_interest: "review_vendor_interest",
    program_proposal: "review_program_proposal",
    gallery_support: "review_gallery_support_offer",
    community_signup: "welcome_community_member",
    contact_message: "respond_to_contact_message",
    meeting_interest: "review_meeting_interest",
  };
  const intentNextActions: Partial<
    Record<NonNullable<RosserGalleryIntakeLeadV1["intent"]>, string>
  > = {
    public_gallery_visit: "schedule_public_gallery_visit",
    private_gallery_walkthrough: "schedule_private_gallery_walkthrough",
    consulting_consultation: "schedule_consulting_consultation",
    artwork_conversation: "schedule_artwork_conversation",
    purchase_guidance: "offer_purchase_guidance",
    community_collaboration: "schedule_community_collaboration",
  };
  const brand =
    payload.businessUnit === "rosser_gallery" ? "Rosser Gallery" : "RT Solutions";
  return {
    source: `${payload.businessUnit}_intake_v1`,
    sourceLabel: `${brand} ${payload.lane.replace(/_/g, " ")}`,
    timelineAction: `crm.intake_${payload.lane}_received`,
    timelineSummary: `${brand} ${payload.lane.replace(/_/g, " ")} received.`,
    nextAction:
      (payload.intent && intentNextActions[payload.intent]) || nextActions[payload.lane],
    tags: [businessTag, laneTag],
  };
}

function consentScopeKey(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"]
): "rosser_gallery_intake" | "rt_solutions_intake" {
  return businessUnit === "rosser_gallery"
    ? "rosser_gallery_intake"
    : "rt_solutions_intake";
}

function readIdentityCustomerId(
  identity: Record<string, unknown>,
  config: RosserGalleryIntakeConfig
): string {
  if (
    identity.ownerUid !== config.ownerUid ||
    identity.workspaceId !== config.workspaceId
  ) {
    throw new ApiError(409, "CRM intake contact identity is bound to a different route");
  }
  if (typeof identity.customerId !== "string" || !identity.customerId.trim()) {
    throw new ApiError(500, "Invalid CRM intake contact identity state");
  }
  return identity.customerId;
}

async function resolveBootstrapCustomerId(
  db: CrmIngestStore,
  email: string,
  deterministicCustomerId: string,
  config: RosserGalleryIntakeConfig
): Promise<string> {
  const snapshot = await db.collection("leads").where("userId", "==", config.ownerUid).get();
  const normalizedEmail = email.trim().toLowerCase();
  const matchingIds = snapshot.docs
    .filter((document) => {
      const row = document.data() || {};
      const storedEmail =
        typeof row.email === "string" ? row.email.trim().toLowerCase() : null;
      const workspaceId =
        typeof row.workspaceId === "string" ? row.workspaceId.trim() : null;
      return (
        storedEmail === normalizedEmail &&
        (!workspaceId || workspaceId === config.workspaceId)
      );
    })
    .map((document) => document.id)
    .sort((left, right) => left.localeCompare(right));

  if (matchingIds.includes(deterministicCustomerId)) return deterministicCustomerId;
  if (matchingIds.length > 1) {
    throw new ApiError(409, "Multiple CRM customers match this contact identity");
  }
  return matchingIds[0] || deterministicCustomerId;
}

function readNotificationQueueResults(
  value: unknown
): IntakeNotificationQueueResult[] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ApiError(500, "Invalid intake notification receipt state");
  }
  const results = value.map((entry) => {
    const record = asRecord(entry);
    if (
      (record.channel !== "owner_alert" &&
        record.channel !== "submitter_acknowledgment") ||
      typeof record.outboxId !== "string" ||
      typeof record.receiptId !== "string" ||
      record.status !== "queued"
    ) {
      throw new ApiError(500, "Invalid intake notification receipt state");
    }
    const channel: IntakeNotificationChannel = record.channel;
    return {
      channel,
      outboxId: record.outboxId,
      receiptId: record.receiptId,
      status: "queued" as const,
    };
  });
  if (new Set(results.map((entry) => entry.channel)).size !== 2) {
    throw new ApiError(500, "Invalid intake notification receipt state");
  }
  return results;
}

function readReceiptResult(args: {
  receiptId: string;
  receipt: Record<string, unknown>;
  expectedFingerprint: string;
  payload: RosserGalleryIntakeLeadV1;
  config: RosserGalleryIntakeConfig;
}): RosserGalleryIntakeIngestResult {
  const crmBusinessUnit = crmBusinessUnitForIntake(args.payload.businessUnit);
  if (args.receipt.payloadFingerprint !== args.expectedFingerprint) {
    throw new ApiError(409, "Idempotency key was already used with a different payload");
  }
  if (
    args.receipt.ownerUid !== args.config.ownerUid ||
    args.receipt.workspaceId !== args.config.workspaceId ||
    args.receipt.businessUnit !== args.payload.businessUnit ||
    args.receipt.crmBusinessUnit !== crmBusinessUnit ||
    args.receipt.lane !== args.payload.lane ||
    args.receipt.source !== "rosser_gallery_intake_v1"
  ) {
    throw new ApiError(409, "Idempotency key is bound to a different intake route");
  }
  const customerId = args.receipt.customerId;
  const timelineEventId = args.receipt.timelineEventId;
  const receivedAt = args.receipt.receivedAt;
  const latestApplied = args.receipt.latestApplied;
  if (
    typeof customerId !== "string" ||
    typeof timelineEventId !== "string" ||
    typeof receivedAt !== "string" ||
    typeof latestApplied !== "boolean"
  ) {
    throw new ApiError(500, "Invalid CRM intake receipt state");
  }
  return {
    replayed: true,
    latestApplied,
    receiptId: args.receiptId,
    customerId,
    timelineEventId,
    notificationChannels: readNotificationQueueResults(
      args.receipt.notificationChannels
    ),
    receivedAt,
    sourceOfTruth: "firestore_projected",
  };
}

export async function ingestRosserGalleryIntakeLead(
  payload: RosserGalleryIntakeLeadV1,
  config: RosserGalleryIntakeConfig,
  dependencies: RosserGalleryIntakeIngestDependencies
): Promise<RosserGalleryIntakeIngestResult> {
  const db = dependencies.db || (getAdminDb() as unknown as CrmIngestStore);
  const now = dependencies.now || (() => new Date());
  const serverTimestamp =
    dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const dailyCreateLimit = dependencies.dailyCreateLimit || 500;
  const receivedAtDate = now();
  const receivedAt = receivedAtDate.toISOString();
  const fingerprint = payloadFingerprint(payload);
  const projection = projectionForIntake(payload);
  const crmBusinessUnit = crmBusinessUnitForIntake(payload.businessUnit);

  const receiptId = stableDocumentId("intake_receipt", payload.externalEventId);
  const timelineEventId = stableDocumentId("intake_activity", payload.externalEventId);
  const consentEventId = stableDocumentId("intake_consent", payload.externalEventId);
  const deterministicCustomerId = stableRosserGalleryCustomerId(
    payload.contact.email,
    config.workspaceId,
    config.customerIdHmacSecret
  );
  const contactIdentityId = stableIntakeIdentityId(
    payload.contact.email,
    config.workspaceId,
    config.customerIdHmacSecret
  );
  const receiptRef = db.collection("crm_ingest_receipts").doc(receiptId);
  const contactIdentityRef = db
    .collection("crm_intake_contact_identities")
    .doc(contactIdentityId);
  const rateLimitRef = db.collection("crm_ingest_rate_limits").doc(
    stableDocumentId(
      "intake_daily",
      `${config.ownerUid}:${config.workspaceId}:${receivedAt.slice(0, 10)}`
    )
  );

  const [preflightReceipt, preflightIdentity] = await Promise.all([
    receiptRef.get(),
    contactIdentityRef.get(),
  ]);
  if (preflightReceipt.exists) {
    return readReceiptResult({
      receiptId,
      receipt: preflightReceipt.data() || {},
      expectedFingerprint: fingerprint,
      payload,
      config,
    });
  }
  assertRosserGalleryIntakeTimestampBounds(payload, receivedAtDate);

  const bootstrapCustomerId = preflightIdentity.exists
    ? readIdentityCustomerId(preflightIdentity.data() || {}, config)
    : await resolveBootstrapCustomerId(
        db,
        payload.contact.email,
        deterministicCustomerId,
        config
      );
  const notificationDrafts = buildIntakeNotificationDrafts(payload, config);
  const notificationChannels: IntakeNotificationQueueResult[] = notificationDrafts.map(
    (draft) => ({
      channel: draft.channel,
      outboxId: stableDocumentId(
        "intake_email",
        `${payload.externalEventId}:${draft.channel}`
      ),
      receiptId: stableDocumentId(
        "intake_email_receipt",
        `${payload.externalEventId}:${draft.channel}`
      ),
      status: "queued" as const,
    })
  );

  return db.runTransaction(async (transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists) {
      return readReceiptResult({
        receiptId,
        receipt: receiptSnapshot.data() || {},
        expectedFingerprint: fingerprint,
        payload,
        config,
      });
    }

    const identitySnapshot = await transaction.get(contactIdentityRef);
    const customerId = identitySnapshot.exists
      ? readIdentityCustomerId(identitySnapshot.data() || {}, config)
      : bootstrapCustomerId;
    const customerRef = db.collection("leads").doc(customerId);
    const timelineRef = db.collection("activities").doc(timelineEventId);
    const consentRef = db.collection("crm_consent_events").doc(consentEventId);
    const customerSnapshot = await transaction.get(customerRef);
    const rateLimitSnapshot = await transaction.get(rateLimitRef);

    const rateLimitRow = rateLimitSnapshot.data() || {};
    const createCount =
      typeof rateLimitRow.createCount === "number" &&
      Number.isFinite(rateLimitRow.createCount)
        ? Math.max(0, Math.floor(rateLimitRow.createCount))
        : 0;
    if (createCount >= dailyCreateLimit) {
      throw new ApiError(429, "CRM intake daily ingest limit reached");
    }

    const existingCustomer = customerSnapshot.data() || {};
    const existingConsentScopes = asRecord(existingCustomer.consentScopes);
    const scopeKey = consentScopeKey(payload.businessUnit);
    const existingIntakeConsent = asRecord(existingConsentScopes[scopeKey]);
    const existingMarketingConsent = existingIntakeConsent.marketingEmail === true;
    const effectiveMarketingConsent =
      existingMarketingConsent || payload.marketingConsent;
    const existingMarketingInterests = stringArray(
      existingIntakeConsent.marketingInterests
    );
    const effectiveMarketingInterests = Array.from(
      new Set([
        ...existingMarketingInterests,
        ...(payload.marketingConsent ? payload.marketingInterests : []),
      ])
    );
    const existingMarketingConsentedAt =
      existingIntakeConsent.marketingConsentedAt || null;
    const incomingMarketingIsNewest =
      payload.marketingConsent &&
      (temporalMillis(existingMarketingConsentedAt) === null ||
        Date.parse(payload.occurredAt) >=
          (temporalMillis(existingMarketingConsentedAt) || 0));
    const existingTransactionalAt =
      existingIntakeConsent.transactionalConsentedAt || null;
    const incomingTransactionalIsNewest =
      temporalMillis(existingTransactionalAt) === null ||
      Date.parse(payload.occurredAt) >= (temporalMillis(existingTransactionalAt) || 0);

    const existingBusinessUnit =
      typeof existingCustomer.businessUnit === "string"
        ? existingCustomer.businessUnit
        : null;
    const businessUnits = Array.from(
      new Set([
        ...(existingBusinessUnit ? [existingBusinessUnit] : []),
        ...stringArray(existingCustomer.businessUnits),
        crmBusinessUnit,
      ])
    );
    const tags = Array.from(
      new Set([...stringArray(existingCustomer.tags), ...projection.tags])
    );
    const existingLastInquiryMillis = temporalMillis(existingCustomer.lastInquiryAt);
    const incomingInquiryMillis = Date.parse(payload.occurredAt);
    const isLatestInquiry =
      !customerSnapshot.exists ||
      existingLastInquiryMillis === null ||
      incomingInquiryMillis >= existingLastInquiryMillis;
    const timestamp = serverTimestamp();

    const customerWrite: Record<string, unknown> = {
      companyName:
        typeof existingCustomer.companyName === "string" &&
        existingCustomer.companyName.trim()
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
      tags,
      consentScopes: {
        ...existingConsentScopes,
        [scopeKey]: {
          ...existingIntakeConsent,
          transactionalContactConsent: true,
          transactionalConsentedAt: incomingTransactionalIsNewest
            ? payload.occurredAt
            : existingTransactionalAt,
          transactionalConsentVersion: "intake-response-v1",
          marketingEmail: effectiveMarketingConsent,
          marketingInterests: effectiveMarketingInterests,
          marketingConsentedAt: incomingMarketingIsNewest
            ? payload.occurredAt
            : existingMarketingConsentedAt,
          marketingConsentVersion: incomingMarketingIsNewest
            ? "intake-marketing-v1"
            : existingIntakeConsent.marketingConsentVersion || null,
          sms: false,
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
        ...(payload.contact.phone ? { phone: payload.contact.phone } : {}),
        latestSource: projection.sourceLabel,
        latestSourceSystem: payload.source,
        sourceEventId: payload.externalEventId,
        latestBusinessUnit: crmBusinessUnit,
        latestRoute:
          payload.businessUnit === "rosser_gallery" ? "rng" : "rt_solutions",
        latestIntakeLane: payload.lane,
        latestIntakeSummary: payload.summary,
        latestMeetingIntent: payload.intent || null,
        latestIntakeMetadata: payload.metadata || null,
        latestPagePath: payload.pagePath || null,
        latestSubmissionPermissions: {
          transactionalContactConsent: true,
          marketingConsent: payload.marketingConsent,
          marketingInterests: payload.marketingInterests,
        },
        lastInquiryAt: payload.occurredAt,
        latestTimelineAt: payload.occurredAt,
        next_action: projection.nextAction,
        correlationId: dependencies.correlationId,
      });
      if (
        typeof existingCustomer.founderName !== "string" ||
        !existingCustomer.founderName.trim()
      ) {
        customerWrite.founderName = payload.contact.name;
      }
    }

    if (!customerSnapshot.exists) {
      Object.assign(customerWrite, {
        founderName: payload.contact.name,
        phone: payload.contact.phone || null,
        recordType: "individual_contact",
        source: projection.sourceLabel,
        sourceSystem: payload.source,
        businessUnit: crmBusinessUnit,
        route:
          payload.businessUnit === "rosser_gallery" ? "rng" : "rt_solutions",
        pipelineStage: "lead_capture",
        status: "new",
        createdAt: timestamp,
      });
    }

    transaction.set(
      contactIdentityRef,
      {
        schemaVersion: 1,
        ownerUid: config.ownerUid,
        workspaceId: config.workspaceId,
        customerId,
        correlationId: dependencies.correlationId,
        updatedAt: timestamp,
        ...(identitySnapshot.exists ? {} : { createdAt: timestamp }),
      },
      { merge: true }
    );
    transaction.set(
      rateLimitRef,
      {
        schemaVersion: 1,
        ownerUid: config.ownerUid,
        workspaceId: config.workspaceId,
        createCount: createCount + 1,
        limit: dailyCreateLimit,
        date: receivedAt.slice(0, 10),
        updatedAt: timestamp,
        ...(rateLimitSnapshot.exists ? {} : { createdAt: timestamp }),
      },
      { merge: true }
    );
    transaction.set(customerRef, customerWrite, { merge: true });
    transaction.set(timelineRef, {
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      owner: config.ownerUid,
      workspaceId: config.workspaceId,
      customerId,
      externalEventId: payload.externalEventId,
      businessUnit: crmBusinessUnit,
      intakeBusinessUnit: payload.businessUnit,
      lane: payload.lane,
      action: projection.timelineAction,
      type: "system",
      summary: projection.timelineSummary,
      details: payload.summary,
      sourceChannel: payload.source,
      meetingIntent: payload.intent || null,
      metadata: payload.metadata || null,
      pagePath: payload.pagePath || null,
      transactionalContactConsent: true,
      marketingConsent: payload.marketingConsent,
      marketingInterests: payload.marketingInterests,
      tags: projection.tags,
      next_action: projection.nextAction,
      correlationId: dependencies.correlationId,
      timestamp: payload.occurredAt,
      ingestedAt: timestamp,
      source: projection.source,
      sourceOfTruth: "firestore_projected",
    });
    transaction.set(consentRef, {
      schemaVersion: 1,
      userId: config.ownerUid,
      ownerUid: config.ownerUid,
      owner: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: crmBusinessUnit,
      intakeBusinessUnit: payload.businessUnit,
      customerId,
      externalEventId: payload.externalEventId,
      scope: scopeKey,
      grants: [
        `${payload.businessUnit}.transactional_contact`,
        ...(payload.marketingConsent
          ? [`${payload.businessUnit}.marketing_email`]
          : []),
      ],
      transactionalContactConsent: true,
      transactionalConsentVersion: "intake-response-v1",
      marketingConsent: payload.marketingConsent,
      marketingConsentVersion: payload.marketingConsent
        ? "intake-marketing-v1"
        : null,
      marketingInterests: payload.marketingInterests,
      consentedAt: payload.occurredAt,
      submittedAt: payload.occurredAt,
      correlationId: dependencies.correlationId,
      lane: payload.lane,
      source: projection.source,
      createdAt: timestamp,
    });

    for (let index = 0; index < notificationDrafts.length; index += 1) {
      const draft = notificationDrafts[index];
      const channel = notificationChannels[index];
      const outboxRef = db.collection("crm_notification_outbox").doc(channel.outboxId);
      const notificationReceiptRef = db
        .collection("crm_notification_receipts")
        .doc(channel.receiptId);
      transaction.set(outboxRef, {
        schemaVersion: 1,
        ownerUid: config.ownerUid,
        workspaceId: config.workspaceId,
        businessUnit: crmBusinessUnit,
        intakeBusinessUnit: payload.businessUnit,
        customerId,
        externalEventId: payload.externalEventId,
        lane: payload.lane,
        channel: draft.channel,
        receiptId: channel.receiptId,
        templateVersion: draft.templateVersion,
        recipient: draft.recipient,
        subject: draft.subject,
        textBody: draft.textBody,
        htmlBody: draft.htmlBody,
        emailFormat: "multipart_alternative",
        status: "queued",
        attemptCount: 0,
        maxAttempts: config.notificationMaxAttempts,
        leaseUntil: null,
        nextAttemptAt: receivedAt,
        lastErrorCode: null,
        correlationId: dependencies.correlationId,
        queuedAt: receivedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(notificationReceiptRef, {
        schemaVersion: 1,
        ownerUid: config.ownerUid,
        workspaceId: config.workspaceId,
        businessUnit: crmBusinessUnit,
        intakeBusinessUnit: payload.businessUnit,
        customerId,
        externalEventId: payload.externalEventId,
        lane: payload.lane,
        channel: draft.channel,
        templateVersion: draft.templateVersion,
        outboxId: channel.outboxId,
        status: "queued",
        attemptCount: 0,
        correlationId: dependencies.correlationId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    transaction.set(receiptRef, {
      schemaVersion: 1,
      contractSchemaVersion: 1,
      source: "rosser_gallery_intake_v1",
      externalEventId: payload.externalEventId,
      payloadFingerprint: fingerprint,
      ownerUid: config.ownerUid,
      workspaceId: config.workspaceId,
      businessUnit: payload.businessUnit,
      crmBusinessUnit,
      lane: payload.lane,
      customerId,
      timelineEventId,
      notificationChannels,
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
      notificationChannels,
      receivedAt,
      sourceOfTruth: "firestore_projected" as const,
    };
  });
}
