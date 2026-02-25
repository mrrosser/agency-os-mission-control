import "server-only";

import { createHash, randomUUID } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import {
  classifySquareEventCategory,
  extractSquareEventType,
  isSquareAllowlistedEventType,
  type SquareEventCategory,
  type SquarePaymentSnapshot,
} from "@/lib/revenue/square";

export const POS_WORKER_EVENT_PREFIXES = ["PAYMENT.", "INVOICE.", "REFUND.", "ORDER."] as const;

export type PosWorkerStage = "source" | "normalize" | "policy" | "execute" | "reconcile";
export type PosWorkerEventStatus = "queued" | "processing" | "completed" | "blocked" | "dead_letter";
export type PosWorkerHealth = "operational" | "degraded" | "offline";
export type PosWorkerActionRisk = "low" | "high";
export type PosWorkerActionKind =
  | "payment.lifecycle.track"
  | "invoice.lifecycle.track"
  | "invoice.followup.queue"
  | "refund.lifecycle.track"
  | "refund.review.queue"
  | "order.lifecycle.track";

export interface PosWorkerActionPlanItem {
  kind: PosWorkerActionKind;
  risk: PosWorkerActionRisk;
  requiresSideEffect: boolean;
  description: string;
}

export interface PosWorkerPolicy {
  allowSideEffects: boolean;
  autoApproveLowRisk: boolean;
  requireApprovalForHighRisk: boolean;
}

export interface PosWorkerEventSummary {
  uid: string;
  eventId: string;
  eventType: string;
  category: SquareEventCategory;
  offerCode: string | null;
  leadDocIdHint: string | null;
  payment: SquarePaymentSnapshot;
}

export interface PosWorkerStatusSummary {
  health: PosWorkerHealth;
  detail: string;
  queuedEvents: number;
  processingEvents: number;
  blockedEvents: number;
  deadLetterEvents: number;
  completedEvents: number;
  oldestPendingSeconds: number;
  outboxQueued: number;
  lastWebhookAt: string | null;
  lastProcessedAt: string | null;
  lastRunAt: string | null;
}

export interface PosWorkerStatusSnapshot {
  generatedAt: string;
  uid: string;
  policy: PosWorkerPolicy;
  supportedEventPrefixes: readonly string[];
  summary: PosWorkerStatusSummary;
}

export interface PosWorkerCycleResult {
  uid: string;
  workerId: string;
  attempted: number;
  completed: number;
  blocked: number;
  deadLettered: number;
  skipped: number;
  replayedActions: number;
  queuedOutboxActions: number;
  correlationId: string;
}

export interface PosOutboxCycleResult {
  uid: string;
  workerId: string;
  attempted: number;
  completed: number;
  deadLettered: number;
  skipped: number;
  replayedTasks: number;
  queuedTasks: number;
  correlationId: string;
}

type EventDocData = {
  status?: string;
  stage?: string;
  eventType?: string;
  eventCategory?: string;
  attemptCount?: number;
  maxAttempts?: number;
  leaseUntil?: string | null;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  lastBlockedReason?: string | null;
  offerCode?: string | null;
  leadDocIdHint?: string | null;
  payment?: SquarePaymentSnapshot;
  completedAt?: unknown;
  receivedAt?: unknown;
  updatedAt?: unknown;
};

type OutboxDocData = {
  status?: string;
  actionKind?: string;
  eventId?: string;
  eventType?: string;
  category?: string;
  risk?: PosWorkerActionRisk;
  offerCode?: string | null;
  leadDocIdHint?: string | null;
  correlationId?: string;
  attemptCount?: number;
  maxAttempts?: number;
  leaseUntil?: string | null;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  completedAt?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
};

type PosOutboxStatus = "queued" | "processing" | "completed" | "dead_letter";

const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_CLAIM_LIMIT = 25;
const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ACTIONS_PER_EVENT = 8;
const SECONDS_PER_MINUTE = 60;
const MINUTE_MS = 60 * 1000;
const OUTBOX_DEFAULT_LIMIT = 25;
const OUTBOX_DEFAULT_LEASE_SECONDS = 90;
const OUTBOX_DEFAULT_MAX_ATTEMPTS = 5;

const POS_WORKER_ACTION_KINDS = [
  "payment.lifecycle.track",
  "invoice.lifecycle.track",
  "invoice.followup.queue",
  "refund.lifecycle.track",
  "refund.review.queue",
  "order.lifecycle.track",
] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      const parsed = candidate.toDate();
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  const parsed = asDate(value);
  return parsed ? parsed.toISOString() : null;
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const normalized = asString(process.env[name] || "").toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function posRoot(uid: string) {
  return getAdminDb().collection("identities").doc(uid);
}

function posEventsCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_events");
}

function posOutboxCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_outbox");
}

function posReceiptsCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_receipts");
}

function posApprovalsCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_approvals");
}

function posOutboxTasksCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_tasks");
}

function posOutboxReceiptsCollection(uid: string) {
  return posRoot(uid).collection("pos_worker_outbox_receipts");
}

function posStatusRef(uid: string) {
  return posRoot(uid).collection("pos_worker").doc("status");
}

export function readPosWorkerPolicy(): PosWorkerPolicy {
  return {
    allowSideEffects: readBoolEnv("POS_WORKER_ALLOW_SIDE_EFFECTS", false),
    autoApproveLowRisk: readBoolEnv("POS_WORKER_AUTO_APPROVE_LOW_RISK", true),
    requireApprovalForHighRisk: readBoolEnv("POS_WORKER_REQUIRE_APPROVAL_FOR_HIGH_RISK", true),
  };
}

export function buildPosWorkerActionPlan(eventType: string): PosWorkerActionPlanItem[] {
  const normalizedEventType = asString(eventType).toUpperCase();
  const category = classifySquareEventCategory(normalizedEventType);

  if (category === "payment") {
    return [
      {
        kind: "payment.lifecycle.track",
        risk: "low",
        requiresSideEffect: false,
        description: "Track payment lifecycle for KPI rollups.",
      },
    ];
  }

  if (category === "invoice") {
    return [
      {
        kind: "invoice.lifecycle.track",
        risk: "low",
        requiresSideEffect: false,
        description: "Track invoice lifecycle and status changes.",
      },
      {
        kind: "invoice.followup.queue",
        risk: "low",
        requiresSideEffect: true,
        description: "Queue deterministic follow-up action for invoice events.",
      },
    ];
  }

  if (category === "refund") {
    return [
      {
        kind: "refund.lifecycle.track",
        risk: "low",
        requiresSideEffect: false,
        description: "Track refund lifecycle and accounting visibility.",
      },
      {
        kind: "refund.review.queue",
        risk: "high",
        requiresSideEffect: true,
        description: "Queue refund review action after explicit approval.",
      },
    ];
  }

  if (category === "order") {
    return [
      {
        kind: "order.lifecycle.track",
        risk: "low",
        requiresSideEffect: false,
        description: "Track order lifecycle and fulfillment changes.",
      },
    ];
  }

  return [];
}

export function summarizePosWorkerHealth(args: {
  lastWebhookAt: string | null;
  deadLetterEvents: number;
  blockedEvents: number;
  oldestPendingSeconds: number;
}): PosWorkerHealth {
  const webhookMs = args.lastWebhookAt ? Date.parse(args.lastWebhookAt) : Number.NaN;
  const webhookAgeMinutes =
    Number.isFinite(webhookMs) && webhookMs > 0 ? Math.max(0, Math.floor((Date.now() - webhookMs) / MINUTE_MS)) : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(webhookAgeMinutes) || webhookAgeMinutes > 72 * SECONDS_PER_MINUTE) {
    return "offline";
  }
  if (
    args.deadLetterEvents > 0 ||
    args.blockedEvents > 0 ||
    args.oldestPendingSeconds > 15 * SECONDS_PER_MINUTE
  ) {
    return "degraded";
  }
  return "operational";
}

function buildPosWorkerDetail(args: {
  health: PosWorkerHealth;
  lastWebhookAt: string | null;
  blockedEvents: number;
  deadLetterEvents: number;
  oldestPendingSeconds: number;
}): string {
  if (args.health === "offline") {
    return "No recent webhook traffic. Check Square webhook delivery + URL configuration.";
  }

  const fragments: string[] = [];
  if (args.lastWebhookAt) fragments.push(`last webhook ${args.lastWebhookAt}`);
  if (args.oldestPendingSeconds > 0) {
    fragments.push(`oldest pending ${Math.floor(args.oldestPendingSeconds / SECONDS_PER_MINUTE)}m`);
  }
  if (args.blockedEvents > 0) fragments.push(`${args.blockedEvents} blocked`);
  if (args.deadLetterEvents > 0) fragments.push(`${args.deadLetterEvents} dead-letter`);

  if (fragments.length === 0) {
    return "Webhook feed active and queue healthy.";
  }
  return fragments.join(" | ");
}

function eventReceiptId(eventId: string, actionKind: PosWorkerActionKind): string {
  return hashId(`${eventId}:${actionKind}`);
}

function eventOutboxId(eventId: string, actionKind: PosWorkerActionKind): string {
  return hashId(`outbox:${eventId}:${actionKind}`);
}

function approvalDocId(eventId: string, actionKind: PosWorkerActionKind): string {
  return hashId(`approval:${eventId}:${actionKind}`);
}

function computeRetryDelaySeconds(attemptCount: number): number {
  return Math.min(3600, 15 * Math.max(1, attemptCount));
}

function isDueForAttempt(event: EventDocData, nowMs: number): boolean {
  const nextAttemptMs = Date.parse(asString(event.nextAttemptAt || ""));
  if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) return false;

  const leaseUntilMs = Date.parse(asString(event.leaseUntil || ""));
  if (Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs) return false;
  return true;
}

function readEventStatus(value: unknown): PosWorkerEventStatus {
  const normalized = asString(value).toLowerCase();
  if (normalized === "processing") return "processing";
  if (normalized === "completed") return "completed";
  if (normalized === "blocked") return "blocked";
  if (normalized === "dead_letter") return "dead_letter";
  return "queued";
}

function readOutboxStatus(value: unknown): PosOutboxStatus {
  const normalized = asString(value).toLowerCase();
  if (normalized === "processing") return "processing";
  if (normalized === "completed") return "completed";
  if (normalized === "dead_letter") return "dead_letter";
  return "queued";
}

function isPosWorkerActionKind(value: unknown): value is PosWorkerActionKind {
  return POS_WORKER_ACTION_KINDS.includes(asString(value) as (typeof POS_WORKER_ACTION_KINDS)[number]);
}

function outboxReceiptId(outboxId: string): string {
  return hashId(`outbox_execute:${outboxId}`);
}

function outboxTaskId(outboxId: string): string {
  return hashId(`task:${outboxId}`);
}

function isOutboxDueForAttempt(outbox: OutboxDocData, nowMs: number): boolean {
  const nextAttemptMs = Date.parse(asString(outbox.nextAttemptAt || ""));
  if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) return false;

  const leaseUntilMs = Date.parse(asString(outbox.leaseUntil || ""));
  if (Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs) return false;
  return true;
}

function toSummary(entry: EventDocData, fallbackType: string): {
  eventType: string;
  actionPlan: PosWorkerActionPlanItem[];
} {
  const eventType = asString(entry.eventType) || fallbackType;
  return {
    eventType,
    actionPlan: buildPosWorkerActionPlan(eventType).slice(0, MAX_ACTIONS_PER_EVENT),
  };
}

async function hasApproval(args: {
  uid: string;
  eventId: string;
  actionKind: PosWorkerActionKind;
}): Promise<boolean> {
  const approvalRef = posApprovalsCollection(args.uid).doc(approvalDocId(args.eventId, args.actionKind));
  const snap = await approvalRef.get();
  if (!snap.exists) return false;
  const data = (snap.data() || {}) as Record<string, unknown>;
  return Boolean(data.approved);
}

async function queueOutboxAction(args: {
  uid: string;
  eventId: string;
  eventType: string;
  category: SquareEventCategory;
  action: PosWorkerActionPlanItem;
  offerCode: string | null;
  leadDocIdHint: string | null;
  correlationId: string;
}): Promise<{ replayed: boolean; queued: boolean }> {
  const db = getAdminDb();
  const receiptId = eventReceiptId(args.eventId, args.action.kind);
  const receiptRef = posReceiptsCollection(args.uid).doc(receiptId);
  const outboxRef = posOutboxCollection(args.uid).doc(eventOutboxId(args.eventId, args.action.kind));
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const existingReceipt = await tx.get(receiptRef);
    if (existingReceipt.exists) {
      return { replayed: true, queued: false };
    }

    tx.set(
      receiptRef,
      {
        uid: args.uid,
        eventId: args.eventId,
        eventType: args.eventType,
        actionKind: args.action.kind,
        risk: args.action.risk,
        correlationId: args.correlationId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (args.action.requiresSideEffect) {
      tx.set(
        outboxRef,
        {
          uid: args.uid,
          eventId: args.eventId,
          eventType: args.eventType,
          category: args.category,
          actionKind: args.action.kind,
          risk: args.action.risk,
          offerCode: args.offerCode,
          leadDocIdHint: args.leadDocIdHint,
          status: "queued",
          attemptCount: 0,
          maxAttempts: clampInt(
            process.env.POS_WORKER_OUTBOX_MAX_ATTEMPTS,
            OUTBOX_DEFAULT_MAX_ATTEMPTS,
            1,
            20
          ),
          leaseUntil: null,
          nextAttemptAt: null,
          lastError: null,
          correlationId: args.correlationId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          queuedAtIso: nowIso,
        },
        { merge: true }
      );
    }

    return { replayed: false, queued: args.action.requiresSideEffect };
  });
}

async function markEventState(args: {
  uid: string;
  eventId: string;
  status: PosWorkerEventStatus;
  stage: PosWorkerStage;
  leaseUntil?: string | null;
  workerId?: string | null;
  lastError?: string | null;
  lastBlockedReason?: string | null;
  nextAttemptAt?: string | null;
  actionPlan?: PosWorkerActionPlanItem[];
  actionsReplayed?: number;
  actionsQueued?: number;
  correlationId: string;
}): Promise<void> {
  const eventRef = posEventsCollection(args.uid).doc(args.eventId);
  await eventRef.set(
    {
      status: args.status,
      stage: args.stage,
      workerId: args.workerId || null,
      leaseUntil: args.leaseUntil || null,
      lastError: args.lastError || null,
      lastBlockedReason: args.lastBlockedReason || null,
      nextAttemptAt: args.nextAttemptAt || null,
      actionPlan: args.actionPlan || [],
      actionsReplayed: args.actionsReplayed || 0,
      actionsQueued: args.actionsQueued || 0,
      correlationId: args.correlationId,
      completedAt: args.status === "completed" ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function claimEvent(args: {
  uid: string;
  eventId: string;
  workerId: string;
  leaseSeconds: number;
  maxAttempts: number;
  correlationId: string;
}): Promise<
  | { state: "claimed"; data: EventDocData; attemptCount: number }
  | { state: "skip" }
  | { state: "dead_letter" }
> {
  const db = getAdminDb();
  const eventRef = posEventsCollection(args.uid).doc(args.eventId);
  const nowMs = Date.now();
  const leaseUntilIso = new Date(nowMs + args.leaseSeconds * 1000).toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(eventRef);
    if (!snap.exists) return { state: "skip" as const };
    const data = (snap.data() || {}) as EventDocData;
    const status = readEventStatus(data.status);
    if (status !== "queued" && status !== "blocked" && status !== "processing") {
      return { state: "skip" as const };
    }
    if (!isDueForAttempt(data, nowMs)) {
      return { state: "skip" as const };
    }

    const currentAttempts = clampInt(data.attemptCount, 0, 0, 999);
    if (currentAttempts >= Math.max(args.maxAttempts, 1)) {
      tx.set(
        eventRef,
        {
          status: "dead_letter",
          stage: "reconcile",
          workerId: null,
          leaseUntil: null,
          nextAttemptAt: null,
          lastError: data.lastError || "max_attempts_exceeded",
          correlationId: args.correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { state: "dead_letter" as const };
    }

    tx.set(
      eventRef,
      {
        status: "processing",
        stage: "source",
        workerId: args.workerId,
        leaseUntil: leaseUntilIso,
        attemptCount: currentAttempts + 1,
        correlationId: args.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { state: "claimed" as const, data, attemptCount: currentAttempts + 1 };
  });
}

async function claimOutboxAction(args: {
  uid: string;
  outboxId: string;
  workerId: string;
  leaseSeconds: number;
  maxAttempts: number;
  correlationId: string;
}): Promise<
  | { state: "claimed"; data: OutboxDocData; attemptCount: number }
  | { state: "skip" }
  | { state: "dead_letter" }
> {
  const db = getAdminDb();
  const outboxRef = posOutboxCollection(args.uid).doc(args.outboxId);
  const nowMs = Date.now();
  const leaseUntilIso = new Date(nowMs + args.leaseSeconds * 1000).toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(outboxRef);
    if (!snap.exists) return { state: "skip" as const };
    const data = (snap.data() || {}) as OutboxDocData;
    const status = readOutboxStatus(data.status);
    if (status !== "queued" && status !== "processing") return { state: "skip" as const };
    if (!isOutboxDueForAttempt(data, nowMs)) return { state: "skip" as const };

    const currentAttempts = clampInt(data.attemptCount, 0, 0, 999);
    const maxAttemptForDoc = clampInt(data.maxAttempts, args.maxAttempts, 1, 20);
    if (currentAttempts >= maxAttemptForDoc) {
      tx.set(
        outboxRef,
        {
          status: "dead_letter",
          leaseUntil: null,
          nextAttemptAt: null,
          lastError: data.lastError || "max_attempts_exceeded",
          correlationId: args.correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { state: "dead_letter" as const };
    }

    tx.set(
      outboxRef,
      {
        status: "processing",
        workerId: args.workerId,
        leaseUntil: leaseUntilIso,
        attemptCount: currentAttempts + 1,
        correlationId: args.correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { state: "claimed" as const, data, attemptCount: currentAttempts + 1 };
  });
}

async function markOutboxState(args: {
  uid: string;
  outboxId: string;
  status: PosOutboxStatus;
  workerId?: string | null;
  leaseUntil?: string | null;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  taskId?: string | null;
  replayed?: boolean;
  correlationId: string;
}): Promise<void> {
  const outboxRef = posOutboxCollection(args.uid).doc(args.outboxId);
  await outboxRef.set(
    {
      status: args.status,
      workerId: args.workerId || null,
      leaseUntil: args.leaseUntil || null,
      lastError: args.lastError || null,
      nextAttemptAt: args.nextAttemptAt || null,
      taskId: args.taskId || null,
      replayed: Boolean(args.replayed),
      correlationId: args.correlationId,
      completedAt: args.status === "completed" ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function queueDeterministicOutboxTask(args: {
  uid: string;
  outboxId: string;
  outbox: OutboxDocData;
  correlationId: string;
}): Promise<{ replayed: boolean; taskId: string }> {
  const db = getAdminDb();
  const receiptRef = posOutboxReceiptsCollection(args.uid).doc(outboxReceiptId(args.outboxId));
  const taskId = outboxTaskId(args.outboxId);
  const taskRef = posOutboxTasksCollection(args.uid).doc(taskId);

  return db.runTransaction(async (tx) => {
    const existingReceipt = await tx.get(receiptRef);
    if (existingReceipt.exists) {
      return { replayed: true, taskId };
    }

    tx.set(
      receiptRef,
      {
        uid: args.uid,
        outboxId: args.outboxId,
        eventId: asString(args.outbox.eventId || ""),
        eventType: asString(args.outbox.eventType || ""),
        actionKind: asString(args.outbox.actionKind || ""),
        risk: asString(args.outbox.risk || ""),
        correlationId: args.correlationId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      taskRef,
      {
        uid: args.uid,
        taskId,
        outboxId: args.outboxId,
        eventId: asString(args.outbox.eventId || ""),
        eventType: asString(args.outbox.eventType || ""),
        category: asString(args.outbox.category || ""),
        actionKind: asString(args.outbox.actionKind || ""),
        risk: asString(args.outbox.risk || ""),
        offerCode: asString(args.outbox.offerCode || "") || null,
        leadDocIdHint: asString(args.outbox.leadDocIdHint || "") || null,
        status: "queued",
        source: "pos_outbox_executor_v1",
        correlationId: args.correlationId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { replayed: false, taskId };
  });
}

export async function runPosOutboxCycle(args: {
  uid: string;
  correlationId: string;
  log: Logger;
  workerId?: string;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}): Promise<PosOutboxCycleResult> {
  const workerId = asString(args.workerId || "") || randomUUID();
  const limit = clampInt(args.limit, OUTBOX_DEFAULT_LIMIT, 1, 100);
  const leaseSeconds = clampInt(args.leaseSeconds, OUTBOX_DEFAULT_LEASE_SECONDS, 15, 300);
  const maxAttempts = clampInt(
    args.maxAttempts,
    clampInt(process.env.POS_WORKER_OUTBOX_MAX_ATTEMPTS, OUTBOX_DEFAULT_MAX_ATTEMPTS, 1, 20),
    1,
    20
  );
  const nowMs = Date.now();

  const candidatesSnap = await posOutboxCollection(args.uid)
    .orderBy("updatedAt", "asc")
    .limit(Math.max(limit * 4, DEFAULT_SCAN_LIMIT))
    .get();

  const candidateIds = candidatesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, data: (docSnap.data() || {}) as OutboxDocData }))
    .filter((entry) => {
      const status = readOutboxStatus(entry.data.status);
      if (status !== "queued" && status !== "processing") return false;
      return isOutboxDueForAttempt(entry.data, nowMs);
    })
    .map((entry) => entry.id)
    .slice(0, limit);

  const policy = readPosWorkerPolicy();
  const result: PosOutboxCycleResult = {
    uid: args.uid,
    workerId,
    attempted: 0,
    completed: 0,
    deadLettered: 0,
    skipped: 0,
    replayedTasks: 0,
    queuedTasks: 0,
    correlationId: args.correlationId,
  };

  for (const outboxId of candidateIds) {
    const claimed = await claimOutboxAction({
      uid: args.uid,
      outboxId,
      workerId,
      leaseSeconds,
      maxAttempts,
      correlationId: args.correlationId,
    });

    if (claimed.state === "skip") {
      result.skipped += 1;
      continue;
    }
    if (claimed.state === "dead_letter") {
      result.deadLettered += 1;
      continue;
    }

    result.attempted += 1;

    try {
      if (!isPosWorkerActionKind(claimed.data.actionKind)) {
        throw new Error("unknown_action_kind");
      }

      if (claimed.data.risk === "high" && policy.requireApprovalForHighRisk) {
        const eventId = asString(claimed.data.eventId || "");
        if (!eventId) throw new Error("missing_event_id_for_approval");
        const approved = await hasApproval({
          uid: args.uid,
          eventId,
          actionKind: claimed.data.actionKind,
        });
        if (!approved) {
          throw new Error("approval_required");
        }
      }

      const queuedTask = await queueDeterministicOutboxTask({
        uid: args.uid,
        outboxId,
        outbox: claimed.data,
        correlationId: args.correlationId,
      });
      if (queuedTask.replayed) result.replayedTasks += 1;
      else result.queuedTasks += 1;

      await markOutboxState({
        uid: args.uid,
        outboxId,
        status: "completed",
        leaseUntil: null,
        workerId: null,
        lastError: null,
        nextAttemptAt: null,
        taskId: queuedTask.taskId,
        replayed: queuedTask.replayed,
        correlationId: args.correlationId,
      });
      result.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttemptAt = new Date(
        Date.now() + computeRetryDelaySeconds(claimed.attemptCount) * 1000
      ).toISOString();
      const nextStatus = claimed.attemptCount >= maxAttempts ? "dead_letter" : "queued";

      await markOutboxState({
        uid: args.uid,
        outboxId,
        status: nextStatus,
        leaseUntil: null,
        workerId: null,
        lastError: message,
        nextAttemptAt: nextStatus === "dead_letter" ? null : nextAttemptAt,
        correlationId: args.correlationId,
      });

      if (nextStatus === "dead_letter") {
        result.deadLettered += 1;
      }

      args.log.warn("revenue.pos.outbox.task_failed", {
        uid: args.uid,
        outboxId,
        workerId,
        message,
        status: nextStatus,
      });
    }
  }

  await posStatusRef(args.uid).set(
    {
      lastOutboxRunAt: FieldValue.serverTimestamp(),
      lastOutboxWorkerId: workerId,
      lastOutboxRunCorrelationId: args.correlationId,
      lastOutboxRunSummary: result,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  args.log.info("revenue.pos.outbox.completed", { ...result });
  return result;
}

export async function queuePosWebhookEvent(args: {
  uid: string;
  eventId: string;
  payload: unknown;
  offerCode: string | null;
  leadDocIdHint: string | null;
  payment: SquarePaymentSnapshot;
  correlationId: string;
  log: Logger;
}): Promise<{ queued: boolean; replayed: boolean; ignored: boolean; reason: string | null; eventType: string | null }> {
  const eventType = extractSquareEventType(args.payload);
  if (!eventType || !isSquareAllowlistedEventType(eventType, POS_WORKER_EVENT_PREFIXES)) {
    args.log.info("revenue.pos.webhook.ignored", {
      eventId: args.eventId,
      eventType: eventType || "unknown",
      reason: "event_type_not_allowlisted",
    });
    return {
      queued: false,
      replayed: false,
      ignored: true,
      reason: "event_type_not_allowlisted",
      eventType,
    };
  }

  const eventCategory = classifySquareEventCategory(eventType);
  const payloadHash = hashId(JSON.stringify(args.payload || {}));
  const eventRef = posEventsCollection(args.uid).doc(args.eventId);
  const statusRef = posStatusRef(args.uid);
  const db = getAdminDb();

  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(eventRef);
    if (existing.exists) {
      tx.set(
        eventRef,
        {
          replayCount: FieldValue.increment(1),
          lastReplayAt: FieldValue.serverTimestamp(),
          correlationId: args.correlationId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        statusRef,
        {
          lastWebhookAt: FieldValue.serverTimestamp(),
          lastWebhookEventType: eventType,
          lastWebhookEventId: args.eventId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { queued: false, replayed: true };
    }

    tx.set(
      eventRef,
      {
        uid: args.uid,
        eventId: args.eventId,
        eventType,
        eventCategory,
        status: "queued",
        stage: "source",
        attemptCount: 0,
        maxAttempts: clampInt(process.env.POS_WORKER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 20),
        replayCount: 0,
        payloadHash,
        offerCode: args.offerCode || null,
        leadDocIdHint: args.leadDocIdHint || null,
        payment: args.payment,
        leaseUntil: null,
        nextAttemptAt: null,
        lastError: null,
        lastBlockedReason: null,
        correlationId: args.correlationId,
        receivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      statusRef,
      {
        lastWebhookAt: FieldValue.serverTimestamp(),
        lastWebhookEventType: eventType,
        lastWebhookEventId: args.eventId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { queued: true, replayed: false };
  });

  args.log.info("revenue.pos.webhook.queued", {
    eventId: args.eventId,
    uid: args.uid,
    eventType,
    eventCategory,
    queued: outcome.queued,
    replayed: outcome.replayed,
  });

  return {
    queued: outcome.queued,
    replayed: outcome.replayed,
    ignored: false,
    reason: null,
    eventType,
  };
}

export async function markPosWebhookEventCompleted(args: {
  uid: string;
  eventId: string;
  correlationId: string;
  log: Logger;
}): Promise<void> {
  await markEventState({
    uid: args.uid,
    eventId: args.eventId,
    status: "completed",
    stage: "reconcile",
    leaseUntil: null,
    workerId: null,
    lastError: null,
    lastBlockedReason: null,
    nextAttemptAt: null,
    correlationId: args.correlationId,
  });
  await posStatusRef(args.uid).set(
    {
      lastProcessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  args.log.info("revenue.pos.webhook.completed_inline", {
    eventId: args.eventId,
    uid: args.uid,
  });
}

export async function runPosWorkerCycle(args: {
  uid: string;
  correlationId: string;
  log: Logger;
  workerId?: string;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}): Promise<PosWorkerCycleResult> {
  const workerId = asString(args.workerId || "") || randomUUID();
  const limit = clampInt(args.limit, DEFAULT_CLAIM_LIMIT, 1, 100);
  const leaseSeconds = clampInt(args.leaseSeconds, DEFAULT_LEASE_SECONDS, 15, 300);
  const maxAttempts = clampInt(
    args.maxAttempts,
    clampInt(process.env.POS_WORKER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 20),
    1,
    20
  );
  const nowMs = Date.now();
  const policy = readPosWorkerPolicy();

  const candidateSnap = await posEventsCollection(args.uid)
    .orderBy("updatedAt", "asc")
    .limit(Math.max(limit * 4, DEFAULT_SCAN_LIMIT))
    .get();

  const candidateEventIds = candidateSnap.docs
    .map((docSnap) => ({ id: docSnap.id, data: (docSnap.data() || {}) as EventDocData }))
    .filter((entry) => {
      const status = readEventStatus(entry.data.status);
      if (status !== "queued" && status !== "processing" && status !== "blocked") return false;
      return isDueForAttempt(entry.data, nowMs);
    })
    .map((entry) => entry.id)
    .slice(0, limit);

  const result: PosWorkerCycleResult = {
    uid: args.uid,
    workerId,
    attempted: 0,
    completed: 0,
    blocked: 0,
    deadLettered: 0,
    skipped: 0,
    replayedActions: 0,
    queuedOutboxActions: 0,
    correlationId: args.correlationId,
  };

  for (const eventId of candidateEventIds) {
    const claimed = await claimEvent({
      uid: args.uid,
      eventId,
      workerId,
      leaseSeconds,
      maxAttempts,
      correlationId: args.correlationId,
    });

    if (claimed.state === "skip") {
      result.skipped += 1;
      continue;
    }
    if (claimed.state === "dead_letter") {
      result.deadLettered += 1;
      continue;
    }

    result.attempted += 1;

    const eventTypeFromDoc = asString(claimed.data.eventType || "");
    const { eventType, actionPlan } = toSummary(claimed.data, eventTypeFromDoc);
    const eventCategory = classifySquareEventCategory(eventType);

    try {
      if (!isSquareAllowlistedEventType(eventType, POS_WORKER_EVENT_PREFIXES)) {
        throw new Error("event_type_not_allowlisted");
      }

      let blockedReason: string | null = null;
      let replayedActions = 0;
      let queuedOutboxActions = 0;

      for (const action of actionPlan) {
        if (action.requiresSideEffect) {
          if (!policy.allowSideEffects) {
            blockedReason = "side_effects_disabled";
            break;
          }
          if (action.risk === "high" && policy.requireApprovalForHighRisk) {
            const approved = await hasApproval({
              uid: args.uid,
              eventId,
              actionKind: action.kind,
            });
            if (!approved) {
              blockedReason = "approval_required";
              break;
            }
          }
          if (action.risk === "low" && !policy.autoApproveLowRisk) {
            const approved = await hasApproval({
              uid: args.uid,
              eventId,
              actionKind: action.kind,
            });
            if (!approved) {
              blockedReason = "approval_required";
              break;
            }
          }
        }

        const queueOutcome = await queueOutboxAction({
          uid: args.uid,
          eventId,
          eventType,
          category: eventCategory,
          action,
          offerCode: asString(claimed.data.offerCode || "") || null,
          leadDocIdHint: asString(claimed.data.leadDocIdHint || "") || null,
          correlationId: args.correlationId,
        });
        if (queueOutcome.replayed) replayedActions += 1;
        if (queueOutcome.queued) queuedOutboxActions += 1;
      }

      if (blockedReason) {
        const delaySeconds = computeRetryDelaySeconds(claimed.attemptCount);
        await markEventState({
          uid: args.uid,
          eventId,
          status: "blocked",
          stage: "policy",
          leaseUntil: null,
          workerId: null,
          lastError: null,
          lastBlockedReason: blockedReason,
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
          actionPlan,
          actionsReplayed: replayedActions,
          actionsQueued: queuedOutboxActions,
          correlationId: args.correlationId,
        });
        result.blocked += 1;
        result.replayedActions += replayedActions;
        result.queuedOutboxActions += queuedOutboxActions;
        continue;
      }

      await markEventState({
        uid: args.uid,
        eventId,
        status: "completed",
        stage: "reconcile",
        leaseUntil: null,
        workerId: null,
        lastError: null,
        lastBlockedReason: null,
        nextAttemptAt: null,
        actionPlan,
        actionsReplayed: replayedActions,
        actionsQueued: queuedOutboxActions,
        correlationId: args.correlationId,
      });

      result.completed += 1;
      result.replayedActions += replayedActions;
      result.queuedOutboxActions += queuedOutboxActions;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttemptAt = new Date(
        Date.now() + computeRetryDelaySeconds(claimed.attemptCount) * 1000
      ).toISOString();

      const nextStatus = claimed.attemptCount >= maxAttempts ? "dead_letter" : "queued";
      if (nextStatus === "dead_letter") {
        result.deadLettered += 1;
      }

      await markEventState({
        uid: args.uid,
        eventId,
        status: nextStatus,
        stage: "execute",
        leaseUntil: null,
        workerId: null,
        lastError: errorMessage,
        lastBlockedReason: null,
        nextAttemptAt: nextStatus === "dead_letter" ? null : nextAttemptAt,
        correlationId: args.correlationId,
      });

      args.log.warn("revenue.pos.worker.event_failed", {
        uid: args.uid,
        eventId,
        workerId,
        status: nextStatus,
        message: errorMessage,
      });
    }
  }

  await posStatusRef(args.uid).set(
    {
      lastRunAt: FieldValue.serverTimestamp(),
      lastWorkerId: workerId,
      lastRunCorrelationId: args.correlationId,
      lastRunSummary: result,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  args.log.info("revenue.pos.worker.completed", { ...result });
  return result;
}

export async function setPosWorkerApproval(args: {
  uid: string;
  eventId: string;
  actionKind: PosWorkerActionKind;
  approved: boolean;
  note?: string | null;
  actorUid: string;
  correlationId: string;
}): Promise<void> {
  const approvalRef = posApprovalsCollection(args.uid).doc(approvalDocId(args.eventId, args.actionKind));
  await approvalRef.set(
    {
      uid: args.uid,
      eventId: args.eventId,
      actionKind: args.actionKind,
      approved: Boolean(args.approved),
      note: asString(args.note || "") || null,
      actorUid: args.actorUid,
      correlationId: args.correlationId,
      updatedAt: FieldValue.serverTimestamp(),
      approvedAt: args.approved ? FieldValue.serverTimestamp() : null,
    },
    { merge: true }
  );
}

export async function getPosWorkerStatus(args: {
  uid: string;
  log: Logger;
}): Promise<PosWorkerStatusSnapshot> {
  const generatedAt = new Date().toISOString();
  const [eventSnap, outboxSnap, statusSnap] = await Promise.all([
    posEventsCollection(args.uid).orderBy("updatedAt", "desc").limit(DEFAULT_SCAN_LIMIT).get(),
    posOutboxCollection(args.uid).orderBy("updatedAt", "desc").limit(DEFAULT_SCAN_LIMIT).get(),
    posStatusRef(args.uid).get(),
  ]);

  let queuedEvents = 0;
  let processingEvents = 0;
  let blockedEvents = 0;
  let deadLetterEvents = 0;
  let completedEvents = 0;
  let oldestPendingMs = Number.POSITIVE_INFINITY;
  let lastWebhookAt: string | null = null;
  let lastProcessedAt: string | null = null;

  for (const docSnap of eventSnap.docs) {
    const data = (docSnap.data() || {}) as EventDocData;
    const status = readEventStatus(data.status);
    const receivedAtIso = toIso(data.receivedAt);
    const completedAtIso = toIso(data.completedAt);

    if (!lastWebhookAt && receivedAtIso) lastWebhookAt = receivedAtIso;
    if (!lastProcessedAt && completedAtIso) lastProcessedAt = completedAtIso;

    if (status === "queued") {
      queuedEvents += 1;
      const receivedMs = Date.parse(receivedAtIso || "");
      if (Number.isFinite(receivedMs) && receivedMs > 0) {
        oldestPendingMs = Math.min(oldestPendingMs, receivedMs);
      }
      continue;
    }
    if (status === "processing") {
      processingEvents += 1;
      const updatedMs = asDate(data.updatedAt)?.getTime() || Number.NaN;
      if (Number.isFinite(updatedMs) && updatedMs > 0) {
        oldestPendingMs = Math.min(oldestPendingMs, updatedMs);
      }
      continue;
    }
    if (status === "blocked") {
      blockedEvents += 1;
      const updatedMs = asDate(data.updatedAt)?.getTime() || Number.NaN;
      if (Number.isFinite(updatedMs) && updatedMs > 0) {
        oldestPendingMs = Math.min(oldestPendingMs, updatedMs);
      }
      continue;
    }
    if (status === "dead_letter") {
      deadLetterEvents += 1;
      continue;
    }
    completedEvents += 1;
  }

  const outboxQueued = outboxSnap.docs.filter((docSnap) => {
    const row = (docSnap.data() || {}) as Record<string, unknown>;
    return asString(row.status || "").toLowerCase() === "queued";
  }).length;

  const oldestPendingSeconds = Number.isFinite(oldestPendingMs)
    ? Math.max(0, Math.floor((Date.now() - oldestPendingMs) / 1000))
    : 0;

  const statusData = (statusSnap.data() || {}) as Record<string, unknown>;
  const lastRunAt = toIso(statusData.lastRunAt);
  const inferredLastWebhookAt = toIso(statusData.lastWebhookAt);
  const inferredLastProcessedAt = toIso(statusData.lastProcessedAt);
  if (!lastWebhookAt) lastWebhookAt = inferredLastWebhookAt;
  if (!lastProcessedAt) lastProcessedAt = inferredLastProcessedAt;

  const health = summarizePosWorkerHealth({
    lastWebhookAt,
    deadLetterEvents,
    blockedEvents,
    oldestPendingSeconds,
  });
  const detail = buildPosWorkerDetail({
    health,
    lastWebhookAt,
    blockedEvents,
    deadLetterEvents,
    oldestPendingSeconds,
  });

  const summary: PosWorkerStatusSummary = {
    health,
    detail,
    queuedEvents,
    processingEvents,
    blockedEvents,
    deadLetterEvents,
    completedEvents,
    oldestPendingSeconds,
    outboxQueued,
    lastWebhookAt,
    lastProcessedAt,
    lastRunAt,
  };

  args.log.info("revenue.pos.status.snapshot", {
    uid: args.uid,
    health,
    queuedEvents,
    blockedEvents,
    deadLetterEvents,
    outboxQueued,
  });

  return {
    generatedAt,
    uid: args.uid,
    policy: readPosWorkerPolicy(),
    supportedEventPrefixes: POS_WORKER_EVENT_PREFIXES,
    summary,
  };
}
