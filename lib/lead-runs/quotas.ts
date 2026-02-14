import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { computeTelemetryFingerprint } from "@/lib/telemetry/fingerprint";
import { storeTelemetryErrorEvent } from "@/lib/telemetry/store";

interface OrgQuotaState {
  windowKey?: string;
  runsUsed?: number;
  leadsUsed?: number;
  activeRunIds?: string[];
  failureStreak?: number;
  failedRuns?: number;
  succeededRuns?: number;
  lastAlertRunId?: string;
}

interface QuotaSettings {
  maxRunsPerDay: number;
  maxLeadsPerDay: number;
  maxActiveRuns: number;
  failureAlertThreshold: number;
  alertEscalationMinutes: number;
}

export interface LeadRunQuotaSummary {
  orgId: string;
  windowKey: string;
  runsUsed: number;
  leadsUsed: number;
  activeRuns: number;
  maxRunsPerDay: number;
  maxLeadsPerDay: number;
  maxActiveRuns: number;
  runsRemaining: number;
  leadsRemaining: number;
  utilization: {
    runsPct: number;
    leadsPct: number;
  };
}

export interface LeadRunAlert {
  alertId: string;
  orgId: string;
  runId: string;
  uid: string;
  severity: string;
  title: string;
  message: string;
  failureStreak: number;
  status: "open" | "acked";
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  escalatedAt?: string | null;
  createdAt?: string | null;
}

const ORG_QUOTA_COLLECTION = "lead_run_org_quotas";
const ORG_ALERT_COLLECTION = "lead_run_alerts";

function sanitizeOrgId(input: string): string {
  const cleaned = input.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.slice(0, 120) || "default";
}

function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function quotaSettings(): QuotaSettings {
  return {
    maxRunsPerDay: readPositiveInt(process.env.LEAD_RUNS_MAX_RUNS_PER_DAY, 80),
    maxLeadsPerDay: readPositiveInt(process.env.LEAD_RUNS_MAX_LEADS_PER_DAY, 1200),
    maxActiveRuns: readPositiveInt(process.env.LEAD_RUNS_MAX_ACTIVE_RUNS, 3),
    failureAlertThreshold: readPositiveInt(process.env.LEAD_RUN_FAILURE_ALERT_THRESHOLD, 3),
    alertEscalationMinutes: readPositiveInt(process.env.LEAD_RUN_ALERT_ESCALATION_MINUTES, 30),
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === "function") {
    try {
      return maybeTimestamp.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") return value;
  return null;
}

export async function resolveLeadRunOrgId(uid: string, log?: Logger): Promise<string> {
  const identityRef = getAdminDb().collection("identities").doc(uid);
  const identitySnap = await identityRef.get();
  if (!identitySnap.exists) return sanitizeOrgId(uid);

  const identity = identitySnap.data() || {};
  const candidates = [
    identity.orgId,
    identity.organizationId,
    identity.workspaceId,
    identity.clientName,
    uid,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const orgId = sanitizeOrgId(candidate);
      if (orgId) {
        log?.info("lead_runs.org.resolve", { uid, orgId });
        return orgId;
      }
    }
  }

  return sanitizeOrgId(uid);
}

export async function claimLeadRunQuota(args: {
  orgId: string;
  uid: string;
  requestedLeads: number;
  runId: string;
  correlationId: string;
  log?: Logger;
}): Promise<{ windowKey: string; maxRunsPerDay: number; maxLeadsPerDay: number }> {
  const { orgId, uid, requestedLeads, runId, correlationId, log } = args;
  const settings = quotaSettings();
  const today = utcDayKey();
  const quotaRef = getAdminDb().collection(ORG_QUOTA_COLLECTION).doc(orgId);

  await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(quotaRef);
    const state = (snap.exists ? (snap.data() as OrgQuotaState) : {}) || {};

    const sameWindow = state.windowKey === today;
    const runsUsed = sameWindow ? Number(state.runsUsed || 0) : 0;
    const leadsUsed = sameWindow ? Number(state.leadsUsed || 0) : 0;

    if (runsUsed + 1 > settings.maxRunsPerDay) {
      throw new ApiError(429, `Daily run limit reached (${settings.maxRunsPerDay}/day).`);
    }
    if (leadsUsed + requestedLeads > settings.maxLeadsPerDay) {
      throw new ApiError(429, `Daily lead limit reached (${settings.maxLeadsPerDay}/day).`);
    }

    const payload: Record<string, unknown> = {
      orgId,
      windowKey: today,
      runsUsed: runsUsed + 1,
      leadsUsed: leadsUsed + requestedLeads,
      maxRunsPerDay: settings.maxRunsPerDay,
      maxLeadsPerDay: settings.maxLeadsPerDay,
      lastRunId: runId,
      lastUid: uid,
      lastCorrelationId: correlationId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    tx.set(quotaRef, payload, { merge: true });
  });

  log?.info("lead_runs.quota.claimed", {
    orgId,
    requestedLeads,
    runId,
    windowKey: today,
    maxRunsPerDay: settings.maxRunsPerDay,
    maxLeadsPerDay: settings.maxLeadsPerDay,
  });

  return {
    windowKey: today,
    maxRunsPerDay: settings.maxRunsPerDay,
    maxLeadsPerDay: settings.maxLeadsPerDay,
  };
}

export async function recordLeadRunOutcome(args: {
  orgId: string;
  runId: string;
  uid: string;
  failed: boolean;
  failureReason?: string | null;
  correlationId: string;
  log?: Logger;
}): Promise<{ shouldAlert: boolean; failureStreak: number }> {
  const { orgId, runId, uid, failed, failureReason, correlationId, log } = args;
  const settings = quotaSettings();
  const quotaRef = getAdminDb().collection(ORG_QUOTA_COLLECTION).doc(orgId);

  const outcome = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(quotaRef);
    const state = (snap.exists ? (snap.data() as OrgQuotaState) : {}) || {};
    const previousStreak = Number(state.failureStreak || 0);
    const failureStreak = failed ? previousStreak + 1 : 0;
    const shouldAlert = failed && failureStreak >= settings.failureAlertThreshold && state.lastAlertRunId !== runId;

    const payload: Record<string, unknown> = {
      failureStreak,
      failedRuns: FieldValue.increment(failed ? 1 : 0),
      succeededRuns: FieldValue.increment(failed ? 0 : 1),
      lastOutcomeRunId: runId,
      lastOutcomeUid: uid,
      lastOutcomeFailed: failed,
      lastFailureReason: failed ? failureReason || "unknown_failure" : FieldValue.delete(),
      lastOutcomeAt: FieldValue.serverTimestamp(),
      lastCorrelationId: correlationId,
    };
    if (shouldAlert) {
      payload.lastAlertRunId = runId;
      payload.lastAlertAt = FieldValue.serverTimestamp();
    }

    tx.set(quotaRef, payload, { merge: true });

    return { shouldAlert, failureStreak };
  });

  if (outcome.shouldAlert) {
    const alertRef = getAdminDb().collection(ORG_ALERT_COLLECTION).doc(`${orgId}_${runId}`);
    await alertRef.set(
      {
        orgId,
        runId,
        uid,
        correlationId,
        severity: "error",
        title: "Lead run failures exceeded threshold",
        message: failureReason || "One or more lead runs failed repeatedly.",
        failureStreak: outcome.failureStreak,
        status: "open",
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    log?.error("lead_runs.alert.failed_job", {
      orgId,
      runId,
      failureStreak: outcome.failureStreak,
      failureReason: failureReason || null,
    });
  } else {
    log?.info("lead_runs.outcome.recorded", {
      orgId,
      runId,
      failed,
      failureStreak: outcome.failureStreak,
    });
  }

  return outcome;
}

export async function acquireLeadRunConcurrencySlot(args: {
  orgId: string;
  runId: string;
  correlationId: string;
  log?: Logger;
}): Promise<{ activeRuns: number; maxActiveRuns: number }> {
  const { orgId, runId, correlationId, log } = args;
  const settings = quotaSettings();
  const quotaRef = getAdminDb().collection(ORG_QUOTA_COLLECTION).doc(orgId);

  const result = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(quotaRef);
    const state = (snap.exists ? (snap.data() as OrgQuotaState) : {}) || {};
    const activeRunIds = Array.isArray(state.activeRunIds) ? [...state.activeRunIds] : [];

    if (activeRunIds.includes(runId)) {
      return {
        activeRuns: activeRunIds.length,
        maxActiveRuns: settings.maxActiveRuns,
      };
    }

    if (activeRunIds.length >= settings.maxActiveRuns) {
      throw new ApiError(
        429,
        `Too many concurrent active runs (${settings.maxActiveRuns}). Pause/finish another run and retry.`
      );
    }

    const nextActive = [...activeRunIds, runId];
    tx.set(
      quotaRef,
      {
        orgId,
        activeRunIds: nextActive,
        activeRuns: nextActive.length,
        maxActiveRuns: settings.maxActiveRuns,
        lastConcurrencyUpdateAt: FieldValue.serverTimestamp(),
        lastCorrelationId: correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      activeRuns: nextActive.length,
      maxActiveRuns: settings.maxActiveRuns,
    };
  });

  log?.info("lead_runs.concurrency.slot_acquired", {
    orgId,
    runId,
    activeRuns: result.activeRuns,
    maxActiveRuns: result.maxActiveRuns,
  });

  return result;
}

export async function releaseLeadRunConcurrencySlot(args: {
  orgId: string;
  runId: string;
  correlationId: string;
  log?: Logger;
}): Promise<void> {
  const { orgId, runId, correlationId, log } = args;
  const quotaRef = getAdminDb().collection(ORG_QUOTA_COLLECTION).doc(orgId);

  const released = await getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(quotaRef);
    const state = (snap.exists ? (snap.data() as OrgQuotaState) : {}) || {};
    const activeRunIds = Array.isArray(state.activeRunIds) ? [...state.activeRunIds] : [];

    if (activeRunIds.length === 0 || !activeRunIds.includes(runId)) {
      return false;
    }

    const nextActive = activeRunIds.filter((id) => id !== runId);
    tx.set(
      quotaRef,
      {
        orgId,
        activeRunIds: nextActive,
        activeRuns: nextActive.length,
        lastConcurrencyUpdateAt: FieldValue.serverTimestamp(),
        lastCorrelationId: correlationId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  });

  if (released) {
    log?.info("lead_runs.concurrency.slot_released", { orgId, runId });
  }
}

export async function getLeadRunQuotaSummary(orgId: string): Promise<LeadRunQuotaSummary> {
  const settings = quotaSettings();
  const today = utcDayKey();
  const quotaRef = getAdminDb().collection(ORG_QUOTA_COLLECTION).doc(orgId);
  const snap = await quotaRef.get();
  const data = snap.exists ? (snap.data() as OrgQuotaState & Record<string, unknown>) : {};

  const sameWindow = data?.windowKey === today;
  const runsUsed = sameWindow ? Number(data?.runsUsed || 0) : 0;
  const leadsUsed = sameWindow ? Number(data?.leadsUsed || 0) : 0;
  const activeRunIds = Array.isArray(data?.activeRunIds) ? (data?.activeRunIds as unknown[]) : [];
  const activeRuns = activeRunIds.filter((id) => typeof id === "string" && id.trim().length > 0).length;
  const maxRunsPerDay = Number(data?.maxRunsPerDay || settings.maxRunsPerDay);
  const maxLeadsPerDay = Number(data?.maxLeadsPerDay || settings.maxLeadsPerDay);
  const maxActiveRuns = Number(data?.maxActiveRuns || settings.maxActiveRuns);

  const runsRemaining = Math.max(0, maxRunsPerDay - runsUsed);
  const leadsRemaining = Math.max(0, maxLeadsPerDay - leadsUsed);

  const runsPct = maxRunsPerDay > 0 ? Math.min(100, Math.round((runsUsed / maxRunsPerDay) * 100)) : 0;
  const leadsPct = maxLeadsPerDay > 0 ? Math.min(100, Math.round((leadsUsed / maxLeadsPerDay) * 100)) : 0;

  return {
    orgId,
    windowKey: today,
    runsUsed,
    leadsUsed,
    activeRuns,
    maxRunsPerDay,
    maxLeadsPerDay,
    maxActiveRuns,
    runsRemaining,
    leadsRemaining,
    utilization: {
      runsPct,
      leadsPct,
    },
  };
}

export async function listLeadRunAlerts(orgId: string, limit = 25): Promise<LeadRunAlert[]> {
  const openSnap = await getAdminDb()
    .collection(ORG_ALERT_COLLECTION)
    .where("orgId", "==", orgId)
    .where("status", "in", ["open", "acked"])
    .limit(Math.max(1, Math.min(limit, 50)))
    .get();

  const items = openSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      alertId: doc.id,
      orgId: String(data.orgId || orgId),
      runId: String(data.runId || ""),
      uid: String(data.uid || ""),
      severity: String(data.severity || "error"),
      title: String(data.title || "Lead run alert"),
      message: String(data.message || ""),
      failureStreak: Number(data.failureStreak || 0),
      status: (data.status === "acked" ? "acked" : "open") as "open" | "acked",
      acknowledgedBy: data.acknowledgedBy ? String(data.acknowledgedBy) : null,
      acknowledgedAt: toIso(data.acknowledgedAt),
      escalatedAt: toIso(data.escalatedAt),
      createdAt: toIso(data.createdAt),
    } satisfies LeadRunAlert;
  });

  items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return items;
}

export async function escalateOpenLeadRunAlerts(args: {
  orgId: string;
  limit?: number;
  log?: Logger;
}): Promise<{ escalated: number }> {
  const { orgId, log } = args;
  const settings = quotaSettings();
  const thresholdMs = settings.alertEscalationMinutes * 60 * 1000;
  const nowMs = Date.now();
  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));

  const snap = await getAdminDb()
    .collection(ORG_ALERT_COLLECTION)
    .where("orgId", "==", orgId)
    .where("status", "==", "open")
    .limit(limit)
    .get();

  let escalated = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.escalatedAt) continue;

    const createdAtIso = toIso(data.createdAt);
    const createdAtMs = createdAtIso ? Date.parse(createdAtIso) : NaN;
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs < thresholdMs) continue;

    const runId = String(data.runId || "");
    const title = String(data.title || "Lead run alert");
    const message = String(data.message || "Lead run alert requires attention.");
    const eventId = `lead-run-alert-escalation:${doc.id}`;
    const event = {
      eventId,
      kind: "server" as const,
      message: `Escalated lead run alert: ${title}`,
      route: "/api/lead-runs/alerts",
      correlationId: runId || undefined,
      occurredAt: new Date().toISOString(),
      meta: {
        source: "lead_runs.alert_escalation",
        orgId,
        alertId: doc.id,
        runId,
        title,
        detail: message,
        failureStreak: Number(data.failureStreak || 0),
      },
    };
    const fingerprint = computeTelemetryFingerprint({
      kind: event.kind,
      message: event.message,
      route: event.route,
      url: "",
    });

    await storeTelemetryErrorEvent(
      {
        fingerprint,
        event,
        uid: data.uid ? String(data.uid) : null,
        ip: null,
      },
      log
    );

    await doc.ref.set(
      {
        escalatedAt: FieldValue.serverTimestamp(),
        escalationStatus: "sent",
        escalationRoute: "telemetry",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    escalated += 1;
  }

  if (escalated > 0) {
    log?.warn("lead_runs.alert.escalated", {
      orgId,
      escalated,
      alertEscalationMinutes: settings.alertEscalationMinutes,
    });
  }

  return { escalated };
}

export async function acknowledgeLeadRunAlert(args: {
  orgId: string;
  alertId: string;
  uid: string;
  note?: string;
  log?: Logger;
}): Promise<void> {
  const ref = getAdminDb().collection(ORG_ALERT_COLLECTION).doc(args.alertId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ApiError(404, "Alert not found");
  }
  const data = snap.data() || {};
  if (String(data.orgId || "") !== args.orgId) {
    throw new ApiError(403, "Forbidden");
  }

  await ref.set(
    {
      status: "acked",
      acknowledgedBy: args.uid,
      acknowledgedAt: FieldValue.serverTimestamp(),
      note: args.note || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  args.log?.info("lead_runs.alert.acked", { orgId: args.orgId, alertId: args.alertId });
}
