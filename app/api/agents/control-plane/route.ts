import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAgentSpaceStatus } from "@/lib/agent-status";
import { getSecretStatus } from "@/lib/api/secrets";
import {
  getAccessTokenForUser,
  getStoredGoogleTokens,
  googleCapabilitiesFromScopeString,
} from "@/lib/google/oauth";
import {
  getLeadRunQuotaSummary,
  listLeadRunAlerts,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  buildControlPlaneSnapshot,
  type ControlPlaneDriveSummary,
  type ControlPlaneExternalToolInput,
  type ControlPlanePosWorkerInput,
  type ControlPlaneRevenueKpiInput,
  type ControlPlaneRuntimeCheckInput,
  type ControlPlaneSkillHealthInput,
  type ControlPlaneSocialPipelineInput,
  type ControlPlaneTelemetryGroup,
} from "@/lib/agent-control-plane";
import { pullProviderBilling } from "@/lib/billing/provider-costs";
import type { Logger } from "@/lib/logging";
import { getPosWorkerStatus } from "@/lib/revenue/pos-worker";
import { buildRuntimePreflightReport } from "@/lib/runtime/preflight";
import { getSocialPipelineHealthSummary } from "@/lib/social/onboarding";

const TELEMETRY_GROUP_LIMIT = 8;
const KNOWLEDGE_PACK_PATH = path.join(
  process.cwd(),
  "please-review",
  "from-root",
  "config-templates",
  "knowledge-pack.v2.json"
);

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    try {
      return candidate.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  const parsed = parseDateLike(value);
  return parsed ? parsed.toISOString() : null;
}

function staleDays(lastRunAtIso: string | null): number | null {
  if (!lastRunAtIso) return null;
  const parsed = Date.parse(lastRunAtIso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readDriveSummary(uid: string): Promise<ControlPlaneDriveSummary> {
  const ref = getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("drive_delta_scan")
    .doc("default");
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      lastRunAt: null,
      staleDays: null,
      lastResultCount: 0,
    };
  }

  const data = snap.data() as Record<string, unknown>;
  const lastRunAt = toIso(data.lastRunAt);
  const lastResultCount = Number(data.lastResultCount || 0);

  return {
    lastRunAt,
    staleDays: staleDays(lastRunAt),
    lastResultCount,
  };
}

async function readSkillHealth(log: { warn: (msg: string, data?: Record<string, unknown>) => void }): Promise<ControlPlaneSkillHealthInput> {
  try {
    const raw = await fs.readFile(KNOWLEDGE_PACK_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const globalPolicies = (parsed.globalPolicies || {}) as Record<string, unknown>;

    return {
      knowledgePackPresent: true,
      hasAgentTopology: Boolean(globalPolicies.agentTopology),
      hasKnowledgeIngestionPolicy: Boolean(globalPolicies.knowledgeIngestionPolicy),
      hasVoiceOpsPolicy: Boolean(globalPolicies.voiceOpsPolicy),
    };
  } catch (error) {
    log.warn("agents.control_plane.knowledge_pack_missing", {
      path: KNOWLEDGE_PACK_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      knowledgePackPresent: false,
      hasAgentTopology: false,
      hasKnowledgeIngestionPolicy: false,
      hasVoiceOpsPolicy: false,
    };
  }
}

async function listTelemetryGroups(uid: string, limit: number): Promise<ControlPlaneTelemetryGroup[]> {
  const eventsSnap = await getAdminDb()
    .collection("telemetry_error_events")
    .where("uid", "==", uid)
    .limit(Math.max(limit * 5, 20))
    .get();

  const fingerprints = Array.from(
    new Set(
      eventsSnap.docs
        .map((doc) => String(doc.data()?.fingerprint || ""))
        .filter((value) => value.length > 0)
    )
  ).slice(0, Math.max(limit * 3, 20));

  if (fingerprints.length === 0) return [];

  const groups = await Promise.all(
    fingerprints.map(async (fingerprint) => {
      const snap = await getAdminDb().collection("telemetry_error_groups").doc(fingerprint).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        fingerprint,
        kind: String(data.kind || "unknown"),
        count: Number(data.count || 0),
        message: String(data.sample?.message || ""),
        route: String(data.sample?.route || ""),
        triageStatus: String(data.triage?.status || "new"),
        triageIssueUrl: data.triage?.issueUrl ? String(data.triage.issueUrl) : null,
        lastSeenAt: toIso(data.lastSeenAt),
      } satisfies ControlPlaneTelemetryGroup;
    })
  );

  return groups
    .filter((group): group is ControlPlaneTelemetryGroup => Boolean(group))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
    })
    .slice(0, limit);
}

function deriveGoogleCapabilities(scopeValue: string | null | undefined) {
  const capabilities = googleCapabilitiesFromScopeString(scopeValue);
  return {
    connected: capabilities.drive || capabilities.gmail || capabilities.calendar,
    ...capabilities,
  };
}

function readExternalToolConfig(): ControlPlaneExternalToolInput {
  const read = (name: string): string | null => {
    const value = process.env[name];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    smAutoEndpoint: read("SMAUTO_MCP_SERVER_URL"),
    leadOpsEndpoint: read("LEADOPS_MCP_SERVER_URL"),
  };
}

function isValidHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function readPosWorkerSummary(
  uid: string,
  log: Logger
): Promise<ControlPlanePosWorkerInput | null> {
  try {
    const snapshot = await getPosWorkerStatus({ uid, log });
    return {
      health: snapshot.summary.health,
      detail: snapshot.summary.detail,
      lastWebhookAt: snapshot.summary.lastWebhookAt,
      oldestPendingSeconds: snapshot.summary.oldestPendingSeconds,
      queuedEvents: snapshot.summary.queuedEvents,
      blockedEvents: snapshot.summary.blockedEvents,
      deadLetterEvents: snapshot.summary.deadLetterEvents,
      outboxQueued: snapshot.summary.outboxQueued,
    };
  } catch (error) {
    log.warn("agents.control_plane.pos_status_unavailable", {
      uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function readRuntimeChecks(): ControlPlaneRuntimeCheckInput[] {
  const report = buildRuntimePreflightReport();
  return report.checks.map((check) => ({
    id: check.id,
    label: check.label,
    state: check.state,
    detail: check.detail,
  }));
}

async function readSocialPipelineSummary(
  uid: string,
  log: Logger
): Promise<ControlPlaneSocialPipelineInput | null> {
  try {
    const pipeline = await getSocialPipelineHealthSummary(uid);
    return {
      draftsPendingApproval: pipeline.drafts.pendingApproval,
      dispatchPendingExternalTool: pipeline.dispatch.pendingExternalTool,
      dispatchFailed: pipeline.dispatch.failed,
      lastDispatchSuccessAt: pipeline.dispatch.lastSuccessAt,
      lastDispatchFailureAt: pipeline.dispatch.lastFailureAt,
    };
  } catch (error) {
    log.warn("agents.control_plane.social_pipeline_unavailable", {
      uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readWeeklyKpiSummary(uid: string): Promise<ControlPlaneRevenueKpiInput | null> {
  const snap = await getAdminDb()
    .collection("identities")
    .doc(uid)
    .collection("revenue_kpi_reports")
    .doc("latest")
    .get();

  if (!snap.exists) return null;
  const row = (snap.data() || {}) as Record<string, unknown>;
  const summary = (row.summary || {}) as Record<string, unknown>;
  const decisionSummary = (row.decisionSummary || {}) as Record<string, unknown>;

  return {
    weekStartDate: asString(row.weekStartDate) || null,
    weekEndDate: asString(row.weekEndDate) || null,
    generatedAt: toIso(row.generatedAt),
    leadsSourced: asNumber(summary.leadsSourced),
    closeRatePct: asNumber(summary.closeRatePct),
    depositsCollected: asNumber(summary.depositsCollected),
    dealsWon: asNumber(summary.dealsWon),
    pipelineValueUsd: asNumber(summary.pipelineValueUsd),
    decisionSummary: {
      scale: asNumber(decisionSummary.scale),
      fix: asNumber(decisionSummary.fix),
      kill: asNumber(decisionSummary.kill),
      watch: asNumber(decisionSummary.watch),
    },
  };
}

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);

    const [
      spaces,
      secretStatus,
      googleTokens,
      orgId,
      driveSummary,
      skillHealth,
      telemetryGroups,
      billing,
      posWorker,
      socialPipeline,
      weeklyKpi,
      runtimeChecks,
    ] =
      await Promise.all([
        getAgentSpaceStatus(user.uid, log),
        getSecretStatus(user.uid),
        getStoredGoogleTokens(user.uid),
        resolveLeadRunOrgId(user.uid, log),
        readDriveSummary(user.uid),
        readSkillHealth(log),
        listTelemetryGroups(user.uid, TELEMETRY_GROUP_LIMIT),
        pullProviderBilling({ uid: user.uid, log }),
        readPosWorkerSummary(user.uid, log),
        readSocialPipelineSummary(user.uid, log),
        readWeeklyKpiSummary(user.uid),
        Promise.resolve(readRuntimeChecks()),
      ]);

    const [quota, alerts] = await Promise.all([
      getLeadRunQuotaSummary(orgId),
      listLeadRunAlerts(orgId, 10),
    ]);

    let google = deriveGoogleCapabilities(googleTokens?.scope || null);
    if (!google.connected && (googleTokens?.refreshToken || googleTokens?.accessToken)) {
      google.connected = true;
    }
    if (google.connected) {
      try {
        await getAccessTokenForUser(user.uid, log);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          google = {
            connected: false,
            drive: false,
            gmail: false,
            calendar: false,
          };
        } else {
          throw error;
        }
      }
    }
    const externalTools = readExternalToolConfig();

    const snapshot = buildControlPlaneSnapshot({
      spaces,
      secretStatus,
      google,
      quota,
      alerts,
      telemetryGroups,
      driveSummary,
      skillHealth,
      externalTools,
      billing,
      posWorker,
      socialPipeline,
      weeklyKpi,
      runtimeChecks,
    });

    log.info("agents.control_plane.snapshot", {
      uid: user.uid,
      health: snapshot.summary.health,
      activeAgents: snapshot.summary.activeAgents,
      openAlerts: snapshot.summary.openAlerts,
      unresolvedBugs: snapshot.summary.unresolvedBugs,
      projectedMonthlyCostUsd: snapshot.summary.projectedMonthlyCostUsd,
      smAutoConfigured: isValidHttpUrl(externalTools.smAutoEndpoint),
      leadOpsConfigured: isValidHttpUrl(externalTools.leadOpsEndpoint),
      posWorkerHealth: posWorker?.health || "unknown",
      posWorkerQueued: posWorker?.queuedEvents ?? null,
      socialDispatchPending: snapshot.operations.socialDispatch.pendingExternalTool,
      socialDispatchFailed: snapshot.operations.socialDispatch.failedDispatch,
      queueHealth: snapshot.operations.queueHealth.state,
      revenueKpiState: snapshot.operations.revenueKpi.state,
      revenueKpiWeek: snapshot.operations.revenueKpi.weekStartDate,
    });

    return NextResponse.json(snapshot);
  },
  { route: "agents.control-plane" }
);
