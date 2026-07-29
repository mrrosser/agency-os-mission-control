import "server-only";

import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import {
  INTAKE_OWNER_NOTIFICATION_EMAIL,
  crmBusinessUnitForIntake,
} from "@/lib/crm/rosser-gallery-intake-config";
import type { RosserGalleryIntakeLeadV1 } from "@/lib/crm/rosser-gallery-intake-contract";
import {
  expectedIntakeNotificationTemplateVersion,
  nextIntakeNotificationFailureState,
  type IntakeNotificationChannel,
} from "@/lib/crm/rosser-gallery-intake-notifications";
import type { RosserGalleryIntakeWorkerConfig } from "@/lib/crm/rosser-gallery-intake-worker-config";
import { getAdminDb } from "@/lib/firebase-admin";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import {
  searchEmails,
  sendEmail,
  type EmailMessage,
  type GmailMessage,
} from "@/lib/google/gmail";
import type { Logger } from "@/lib/logging";

interface DocumentSnapshotLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

interface DocumentReferenceLike {
  id: string;
  get(): Promise<DocumentSnapshotLike>;
  set(
    data: Record<string, unknown>,
    options?: { merge: boolean }
  ): Promise<unknown>;
}

interface QueryDocumentSnapshotLike extends DocumentSnapshotLike {
  id: string;
}

interface QueryLike {
  limit(value: number): QueryLike;
  get(): Promise<{ docs: QueryDocumentSnapshotLike[] }>;
}

interface TransactionLike {
  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>;
  set(
    reference: DocumentReferenceLike,
    data: Record<string, unknown>,
    options?: { merge: boolean }
  ): TransactionLike;
}

export interface IntakeNotificationWorkerStore {
  collection(name: string): {
    doc(id: string): DocumentReferenceLike;
    where(field: string, operator: "==", value: unknown): QueryLike;
  };
  runTransaction<T>(
    operation: (transaction: TransactionLike) => Promise<T>
  ): Promise<T>;
}

interface ClaimedNotification {
  outboxId: string;
  receiptId: string;
  channel: IntakeNotificationChannel;
  recipient: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  templateVersion: string;
  attemptCount: number;
  maxAttempts: number;
  workerId: string;
}

export interface IntakeNotificationWorkerResult {
  candidates: number;
  claimed: number;
  sent: number;
  recovered: number;
  retried: number;
  deadLettered: number;
  skipped: number;
  failed: number;
}

export interface IntakeNotificationWorkerDependencies {
  db?: IntakeNotificationWorkerStore;
  now?: () => Date;
  serverTimestamp?: () => unknown;
  getAccessToken?: typeof getAccessTokenForUser;
  send?: (
    accessToken: string,
    email: EmailMessage,
    log?: Logger
  ) => Promise<{ id: string; threadId: string }>;
  search?: (
    accessToken: string,
    query: string,
    maxResults?: number,
    log?: Logger
  ) => Promise<GmailMessage[]>;
}

const emailAddressSchema = z.string().trim().toLowerCase().email().max(320);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function dateMillis(value: unknown): number | null {
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

function expectedTemplateVersion(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"],
  channel: IntakeNotificationChannel
): string {
  return expectedIntakeNotificationTemplateVersion(businessUnit, channel);
}

function isDue(row: Record<string, unknown>, nowMs: number): boolean {
  const status = asString(row.status);
  if (status === "queued") {
    const nextAttemptAt = dateMillis(row.nextAttemptAt);
    return nextAttemptAt === null || nextAttemptAt <= nowMs;
  }
  if (status === "processing") {
    const leaseUntil = dateMillis(row.leaseUntil);
    return leaseUntil === null || leaseUntil <= nowMs;
  }
  return false;
}

function messageIdForOutbox(outboxId: string): string {
  const digest = createHash("sha256").update(outboxId, "utf8").digest("hex");
  return `<intake.${digest.slice(0, 48)}@rossergallery.com>`;
}

function messageIdSearchQuery(messageId: string): string {
  return `in:sent rfc822msgid:${messageId.slice(1, -1)}`;
}

function errorCode(error: unknown): string {
  if (error instanceof ApiError) return `api_${error.status}`;
  if (error && typeof error === "object") {
    const name = asString((error as Record<string, unknown>).name);
    if (name) return name.slice(0, 80);
  }
  return "delivery_error";
}

async function listCandidateIds(args: {
  db: IntakeNotificationWorkerStore;
  limit: number;
  now: Date;
}): Promise<string[]> {
  const collection = args.db.collection("crm_notification_outbox");
  const scanLimit = Math.min(100, Math.max(25, args.limit * 4));
  const [queued, processing] = await Promise.all([
    collection.where("status", "==", "queued").limit(scanLimit).get(),
    collection.where("status", "==", "processing").limit(scanLimit).get(),
  ]);
  const candidates = [...queued.docs, ...processing.docs]
    .filter((document) => isDue(document.data() || {}, args.now.getTime()))
    .sort((left, right) => {
      const leftRow = left.data() || {};
      const rightRow = right.data() || {};
      return (
        asString(leftRow.queuedAt).localeCompare(asString(rightRow.queuedAt)) ||
        left.id.localeCompare(right.id)
      );
    });
  return Array.from(new Set(candidates.map((document) => document.id))).slice(
    0,
    args.limit
  );
}

function readClaimedNotification(args: {
  outboxId: string;
  outbox: Record<string, unknown>;
  receipt: Record<string, unknown>;
  customer: Record<string, unknown>;
  config: RosserGalleryIntakeWorkerConfig;
  attemptCount: number;
  workerId: string;
}): ClaimedNotification {
  const intakeBusinessUnit = asString(args.outbox.intakeBusinessUnit);
  if (
    intakeBusinessUnit !== "rosser_gallery" &&
    intakeBusinessUnit !== "rt_solutions"
  ) {
    throw new ApiError(500, "Invalid notification business unit");
  }
  const channel = asString(args.outbox.channel);
  if (channel !== "owner_alert" && channel !== "submitter_acknowledgment") {
    throw new ApiError(500, "Invalid notification channel");
  }
  const recipient = emailAddressSchema.safeParse(args.outbox.recipient);
  if (!recipient.success) {
    throw new ApiError(500, "Invalid notification recipient");
  }
  const templateVersion = asString(args.outbox.templateVersion);
  const expectedTemplate = expectedTemplateVersion(intakeBusinessUnit, channel);
  const expectedCrmBusinessUnit = crmBusinessUnitForIntake(intakeBusinessUnit);
  if (
    args.outbox.schemaVersion !== 1 ||
    args.outbox.ownerUid !== args.config.gmailUserId ||
    args.outbox.businessUnit !== expectedCrmBusinessUnit ||
    templateVersion !== expectedTemplate ||
    args.outbox.emailFormat !== "multipart_alternative"
  ) {
    throw new ApiError(500, "Notification route or template is not allowlisted");
  }
  if (
    channel === "owner_alert" &&
    recipient.data !== INTAKE_OWNER_NOTIFICATION_EMAIL
  ) {
    throw new ApiError(500, "Owner notification recipient is not allowlisted");
  }
  if (
    channel === "submitter_acknowledgment" &&
    recipient.data !== asString(args.customer.email).toLowerCase()
  ) {
    throw new ApiError(500, "Submitter notification recipient does not match CRM contact");
  }

  const receiptId = asString(args.receipt.id) || asString(args.outbox.receiptId);
  const receiptOutboxId = asString(args.receipt.outboxId);
  if (
    !receiptOutboxId ||
    receiptOutboxId !== args.outboxId ||
    args.receipt.channel !== channel ||
    args.receipt.templateVersion !== templateVersion
  ) {
    throw new ApiError(500, "Notification channel receipt does not match outbox");
  }

  const subject = asString(args.outbox.subject);
  const textBody = asString(args.outbox.textBody);
  const htmlBody = asString(args.outbox.htmlBody);
  const maxAttempts = asInteger(args.outbox.maxAttempts, 0);
  if (
    !receiptId ||
    !subject ||
    subject.length > 240 ||
    /[\r\n]/.test(subject) ||
    !textBody ||
    textBody.length > 20_000 ||
    !htmlBody ||
    htmlBody.length > 40_000 ||
    maxAttempts < 1 ||
    maxAttempts > 20
  ) {
    throw new ApiError(500, "Invalid notification delivery content");
  }

  return {
    outboxId: args.outboxId,
    receiptId,
    channel,
    recipient: recipient.data,
    subject,
    textBody,
    htmlBody,
    templateVersion,
    attemptCount: args.attemptCount,
    maxAttempts,
    workerId: args.workerId,
  };
}

async function claimNotification(args: {
  db: IntakeNotificationWorkerStore;
  outboxId: string;
  config: RosserGalleryIntakeWorkerConfig;
  workerId: string;
  leaseSeconds: number;
  now: Date;
  serverTimestamp: () => unknown;
}): Promise<
  | { state: "claimed"; notification: ClaimedNotification }
  | { state: "skip" }
  | { state: "dead_letter" }
> {
  const outboxRef = args.db.collection("crm_notification_outbox").doc(args.outboxId);
  return args.db.runTransaction(async (transaction) => {
    const outboxSnapshot = await transaction.get(outboxRef);
    if (!outboxSnapshot.exists) return { state: "skip" as const };
    const outbox = outboxSnapshot.data() || {};
    const receiptId = asString(outbox.receiptId) ||
      `intake_email_receipt_${args.outboxId.replace(/^intake_email_/, "")}`;
    const receiptRef = args.db
      .collection("crm_notification_receipts")
      .doc(receiptId);
    const customerId = asString(outbox.customerId);
    if (!customerId) throw new ApiError(500, "Notification customer is missing");
    const customerRef = args.db.collection("leads").doc(customerId);
    const receiptSnapshot = await transaction.get(receiptRef);
    const customerSnapshot = await transaction.get(customerRef);
    if (!receiptSnapshot.exists || !customerSnapshot.exists) {
      throw new ApiError(500, "Notification receipt or CRM contact is missing");
    }
    const receipt: Record<string, unknown> = {
      id: receiptId,
      ...(receiptSnapshot.data() || {}),
    };
    if (receipt.status === "completed") {
      if (outbox.status !== "completed") {
        transaction.set(
          outboxRef,
          {
            status: "completed",
            leaseUntil: null,
            nextAttemptAt: null,
            updatedAt: args.serverTimestamp(),
          },
          { merge: true }
        );
      }
      return { state: "skip" as const };
    }
    if (!isDue(outbox, args.now.getTime())) return { state: "skip" as const };

    const currentAttempts = Math.max(0, asInteger(outbox.attemptCount, 0));
    const maxAttempts = Math.max(1, asInteger(outbox.maxAttempts, 0));
    if (currentAttempts >= maxAttempts) {
      const update = {
        status: "dead_letter",
        leaseUntil: null,
        nextAttemptAt: null,
        lastErrorCode: "max_attempts_reached",
        updatedAt: args.serverTimestamp(),
      };
      transaction.set(outboxRef, update, { merge: true });
      transaction.set(receiptRef, update, { merge: true });
      return { state: "dead_letter" as const };
    }

    const attemptCount = currentAttempts + 1;
    const claimed = readClaimedNotification({
      outboxId: args.outboxId,
      outbox,
      receipt,
      customer: customerSnapshot.data() || {},
      config: args.config,
      attemptCount,
      workerId: args.workerId,
    });
    const leaseUntil = new Date(
      args.now.getTime() + args.leaseSeconds * 1_000
    ).toISOString();
    const claimUpdate = {
      status: "processing",
      attemptCount,
      workerId: args.workerId,
      leaseUntil,
      nextAttemptAt: null,
      lastErrorCode: null,
      updatedAt: args.serverTimestamp(),
    };
    transaction.set(outboxRef, claimUpdate, { merge: true });
    transaction.set(receiptRef, claimUpdate, { merge: true });
    return { state: "claimed" as const, notification: claimed };
  });
}

async function markNotificationCompleted(args: {
  db: IntakeNotificationWorkerStore;
  notification: ClaimedNotification;
  gmailMessageId: string;
  gmailThreadId: string;
  deterministicMessageId: string;
  recovered: boolean;
  completedAt: Date;
  serverTimestamp: () => unknown;
}): Promise<boolean> {
  const outboxRef = args.db
    .collection("crm_notification_outbox")
    .doc(args.notification.outboxId);
  const receiptRef = args.db
    .collection("crm_notification_receipts")
    .doc(args.notification.receiptId);
  return args.db.runTransaction(async (transaction) => {
    const outboxSnapshot = await transaction.get(outboxRef);
    const receiptSnapshot = await transaction.get(receiptRef);
    const outbox = outboxSnapshot.data() || {};
    const receipt = receiptSnapshot.data() || {};
    if (receipt.status === "completed") return false;
    if (
      !outboxSnapshot.exists ||
      !receiptSnapshot.exists ||
      outbox.status !== "processing" ||
      outbox.workerId !== args.notification.workerId
    ) {
      return false;
    }
    const update = {
      status: "completed",
      attemptCount: args.notification.attemptCount,
      workerId: args.notification.workerId,
      leaseUntil: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      deterministicMessageId: args.deterministicMessageId,
      gmailMessageId: args.gmailMessageId,
      gmailThreadId: args.gmailThreadId,
      recovered: args.recovered,
      completedAt: args.completedAt.toISOString(),
      updatedAt: args.serverTimestamp(),
    };
    transaction.set(outboxRef, update, { merge: true });
    transaction.set(receiptRef, update, { merge: true });
    return true;
  });
}

async function markNotificationFailed(args: {
  db: IntakeNotificationWorkerStore;
  notification: ClaimedNotification;
  code: string;
  failedAt: Date;
  serverTimestamp: () => unknown;
}): Promise<"queued" | "dead_letter" | "skip"> {
  const outboxRef = args.db
    .collection("crm_notification_outbox")
    .doc(args.notification.outboxId);
  const receiptRef = args.db
    .collection("crm_notification_receipts")
    .doc(args.notification.receiptId);
  return args.db.runTransaction(async (transaction) => {
    const outboxSnapshot = await transaction.get(outboxRef);
    const receiptSnapshot = await transaction.get(receiptRef);
    const outbox = outboxSnapshot.data() || {};
    const receipt = receiptSnapshot.data() || {};
    if (
      receipt.status === "completed" ||
      !outboxSnapshot.exists ||
      !receiptSnapshot.exists ||
      outbox.status !== "processing" ||
      outbox.workerId !== args.notification.workerId
    ) {
      return "skip" as const;
    }
    const nextState = nextIntakeNotificationFailureState({
      attemptCount: args.notification.attemptCount,
      maxAttempts: args.notification.maxAttempts,
      failedAt: args.failedAt,
    });
    const update = {
      status: nextState.status,
      attemptCount: args.notification.attemptCount,
      workerId: args.notification.workerId,
      leaseUntil: null,
      nextAttemptAt: nextState.nextAttemptAt,
      lastErrorCode: args.code.slice(0, 80),
      updatedAt: args.serverTimestamp(),
    };
    transaction.set(outboxRef, update, { merge: true });
    transaction.set(receiptRef, update, { merge: true });
    return nextState.status;
  });
}

export async function runIntakeNotificationWorkerCycle(args: {
  config: RosserGalleryIntakeWorkerConfig;
  correlationId: string;
  log: Logger;
  limit?: number;
  leaseSeconds?: number;
  dependencies?: IntakeNotificationWorkerDependencies;
}): Promise<IntakeNotificationWorkerResult> {
  const dependencies = args.dependencies || {};
  const db =
    dependencies.db ||
    (getAdminDb() as unknown as IntakeNotificationWorkerStore);
  const now = dependencies.now || (() => new Date());
  const serverTimestamp =
    dependencies.serverTimestamp || (() => FieldValue.serverTimestamp());
  const getAccessToken = dependencies.getAccessToken || getAccessTokenForUser;
  const deliver = dependencies.send || sendEmail;
  const search = dependencies.search || searchEmails;
  const limit = Math.min(25, Math.max(1, Math.floor(args.limit || 10)));
  const leaseSeconds = Math.min(
    300,
    Math.max(15, Math.floor(args.leaseSeconds || 90))
  );
  const workerId = `intake-worker:${args.correlationId}`;
  const cycleNow = now();
  const candidateIds = await listCandidateIds({ db, limit, now: cycleNow });
  const result: IntakeNotificationWorkerResult = {
    candidates: candidateIds.length,
    claimed: 0,
    sent: 0,
    recovered: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0,
    failed: 0,
  };
  let accessTokenPromise: Promise<string> | null = null;
  const accessToken = () => {
    accessTokenPromise ||= getAccessToken(args.config.gmailUserId, args.log);
    return accessTokenPromise;
  };

  for (const outboxId of candidateIds) {
    let claimed:
      | Awaited<ReturnType<typeof claimNotification>>
      | undefined;
    try {
      claimed = await claimNotification({
        db,
        outboxId,
        config: args.config,
        workerId,
        leaseSeconds,
        now: cycleNow,
        serverTimestamp,
      });
    } catch (error) {
      result.failed += 1;
      args.log.warn("crm.intake_notification.claim_failed", {
        outboxId,
        errorCode: errorCode(error),
      });
      continue;
    }
    if (claimed.state === "skip") {
      result.skipped += 1;
      continue;
    }
    if (claimed.state === "dead_letter") {
      result.deadLettered += 1;
      continue;
    }

    result.claimed += 1;
    const notification = claimed.notification;
    const deterministicMessageId = messageIdForOutbox(notification.outboxId);
    try {
      const token = await accessToken();
      const priorMessages = await search(
        token,
        messageIdSearchQuery(deterministicMessageId),
        1,
        args.log
      );
      const prior = priorMessages[0];
      if (prior?.id) {
        const completed = await markNotificationCompleted({
          db,
          notification,
          gmailMessageId: prior.id,
          gmailThreadId: prior.threadId || prior.id,
          deterministicMessageId,
          recovered: true,
          completedAt: now(),
          serverTimestamp,
        });
        if (completed) result.recovered += 1;
        else result.skipped += 1;
        continue;
      }

      const delivered = await deliver(
        token,
        {
          to: [notification.recipient],
          subject: notification.subject,
          body: notification.textBody,
          htmlBody: notification.htmlBody,
          messageId: deterministicMessageId,
        },
        args.log
      );
      const completed = await markNotificationCompleted({
        db,
        notification,
        gmailMessageId: delivered.id,
        gmailThreadId: delivered.threadId,
        deterministicMessageId,
        recovered: false,
        completedAt: now(),
        serverTimestamp,
      });
      if (completed) result.sent += 1;
      else result.skipped += 1;
    } catch (error) {
      const state = await markNotificationFailed({
        db,
        notification,
        code: errorCode(error),
        failedAt: now(),
        serverTimestamp,
      });
      result.failed += 1;
      if (state === "queued") result.retried += 1;
      if (state === "dead_letter") result.deadLettered += 1;
      if (state === "skip") result.skipped += 1;
      args.log.warn("crm.intake_notification.delivery_failed", {
        outboxId: notification.outboxId,
        channel: notification.channel,
        attemptCount: notification.attemptCount,
        state,
        errorCode: errorCode(error),
      });
    }
  }

  args.log.info("crm.intake_notification.worker_completed", { ...result });
  return result;
}
