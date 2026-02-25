import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAgentSpaceStatus } from "@/lib/agent-status";
import { getSecretStatus } from "@/lib/api/secrets";
import { getStoredGoogleTokens } from "@/lib/google/oauth";
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
  type ControlPlaneSkillHealthInput,
  type ControlPlaneTelemetryGroup,
} from "@/lib/agent-control-plane";
import { pullProviderBilling } from "@/lib/billing/provider-costs";
import type { Logger } from "@/lib/logging";
import { getPosWorkerStatus } from "@/lib/revenue/pos-worker";

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
  const scope = scopeValue || "";
  const scopes = scope
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    connected: scopes.length > 0,
    drive: scopes.some((value) => value.includes("/auth/drive")),
    gmail: scopes.some((value) => value.includes("/auth/gmail")),
    calendar: scopes.some((value) => value.includes("/auth/calendar")),
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

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);

    const [spaces, secretStatus, googleTokens, orgId, driveSummary, skillHealth, telemetryGroups, billing, posWorker] =
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
      ]);

    const [quota, alerts] = await Promise.all([
      getLeadRunQuotaSummary(orgId),
      listLeadRunAlerts(orgId, 10),
    ]);

    const google = deriveGoogleCapabilities(googleTokens?.scope || null);
    if (!google.connected && (googleTokens?.refreshToken || googleTokens?.accessToken)) {
      google.connected = true;
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
    });

    return NextResponse.json(snapshot);
  },
  { route: "agents.control-plane" }
);
