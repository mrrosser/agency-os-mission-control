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
  type ControlPlaneRevenueKpiInput,
  type ControlPlaneRuntimeCheckInput,
  type ControlPlaneSkillHealthInput,
  type ControlPlaneSocialPipelineInput,
  type ControlPlaneTelemetryGroup,
} from "@/lib/agent-control-plane";
import type {
  BudgetGovernorInput,
  BudgetProviderInput,
  MobileOpsInput,
  PaperclipControlSnapshot,
} from "@/lib/control-plane/autonomous-business";
import { pullProviderBilling } from "@/lib/billing/provider-costs";
import type { Logger } from "@/lib/logging";
import { normalizePaperclipCustomers } from "@/lib/crm/customer-memory";
import { PaperclipClient, readPaperclipClientConfig } from "@/lib/paperclip/client";
import { BUSINESS_UNIT_OPTIONS, OFFER_DEFINITIONS } from "@/lib/revenue/offers";
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

function readBooleanEnv(name: string, fallback: boolean = false): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function readNumberEnv(name: string): number | null {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readNumberRecordEnv(name: string): Record<string, number> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? [[key, numeric]] : [];
      })
    );
  } catch {
    return {};
  }
}

function newestIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > bestMs) {
      best = value;
      bestMs = parsed;
    }
  }
  return best;
}

function projectMonthEndUsd(totalUsd: number): number | null {
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return null;
  const now = new Date();
  const day = Math.max(1, now.getUTCDate());
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.round((totalUsd / day) * daysInMonth * 100) / 100;
}

async function readPaperclipSummary(log: Logger): Promise<PaperclipControlSnapshot> {
  const config = readPaperclipClientConfig();
  if (!config) {
    return {
      state: "degraded",
      configured: false,
      reachable: false,
      canProxyActions: false,
      baseUrl: null,
      sourceOfTruth: "mission_control",
      companyCount: null,
      agentCount: null,
      activeRunCount: null,
      detail: "Paperclip API base URL is not configured yet.",
      capabilities: {
        lifecycleActions: false,
        heartbeats: false,
        budgets: false,
        audit: false,
        mobile: false,
      },
    };
  }

  const client = new PaperclipClient(config);
  return client.getControlSnapshot(log);
}

async function readCustomerProjection(
  uid: string,
  log: Logger
): Promise<{
  sourceOfTruth: "paperclip" | "firestore_projected";
  knownContacts: number;
  recentTimelineEvents: number;
  lastTimelineAt: string | null;
}> {
  const config = readPaperclipClientConfig();
  if (config) {
    try {
      const client = new PaperclipClient(config);
      const payload = await client.listCustomers({
        correlationId: `agents-control-plane:${uid}`,
        requestedByUid: uid,
        limit: 200,
      });
      const customers = normalizePaperclipCustomers(payload);
      return {
        sourceOfTruth: "paperclip",
        knownContacts: customers.length,
        recentTimelineEvents: customers.reduce(
          (sum, customer) => sum + Math.max(0, customer.timelineCount || 0),
          0
        ),
        lastTimelineAt: newestIso(customers.map((customer) => customer.lastTimelineAt)),
      };
    } catch (error) {
      log.warn("agents.control_plane.paperclip_customer_projection_fallback", {
        uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const db = getAdminDb() as unknown as Record<string, unknown>;
    const leadsCollection = typeof db.collection === "function" ? db.collection("leads") : null;
    const leadsQuery =
      leadsCollection && typeof (leadsCollection as { where?: unknown }).where === "function"
        ? (leadsCollection as {
            where: (field: string, op: string, value: string) => { limit: (count: number) => { get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }> } };
          }).where("userId", "==", uid)
        : null;
    const posCollection =
      typeof db.collection === "function"
        ? (db.collection("identities") as {
            doc?: (id: string) => {
              collection?: (name: string) => {
                orderBy?: (field: string, direction: string) => { limit: (count: number) => { get: () => Promise<{ docs: Array<{ data: () => Record<string, unknown> }> }> } };
              };
            };
          }).doc?.(uid)?.collection?.("pos_worker_events")
        : null;

    const [leadDocs, posDocs] = await Promise.all([
      leadsQuery?.limit(200).get().catch(() => null) || Promise.resolve(null),
      posCollection?.orderBy?.("updatedAt", "desc")?.limit(25).get().catch(() => null) ||
        Promise.resolve(null),
    ]);

    const leadTimestamps =
      leadDocs?.docs
        ?.map((doc) => {
          const row = doc.data();
          return toIso(row.updatedAt) || toIso(row.createdAt);
        })
        .filter(Boolean) || [];
    const posTimestamps =
      posDocs?.docs
        ?.map((doc) => {
          const row = doc.data();
          return toIso(row.updatedAt) || toIso(row.createdAt);
        })
        .filter(Boolean) || [];

    return {
      sourceOfTruth: "firestore_projected",
      knownContacts: leadDocs?.docs?.length || 0,
      recentTimelineEvents: (leadDocs?.docs?.length || 0) + (posDocs?.docs?.length || 0),
      lastTimelineAt: newestIso([...leadTimestamps, ...posTimestamps]),
    };
  } catch (error) {
    log.warn("agents.control_plane.customer_projection_unavailable", {
      uid,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      sourceOfTruth: "firestore_projected",
      knownContacts: 0,
      recentTimelineEvents: 0,
      lastTimelineAt: null,
    };
  }
}

function buildBudgetGovernorInput(args: {
  secretStatus: Awaited<ReturnType<typeof getSecretStatus>>;
  googleConnected: boolean;
  billing: Awaited<ReturnType<typeof pullProviderBilling>>;
}): BudgetGovernorInput {
  const providerBudgets = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_BUDGETS_JSON");
  const providerEstimates = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_ESTIMATES_JSON");
  const providerUnreconciled = readNumberRecordEnv("MISSION_CONTROL_PROVIDER_UNRECONCILED_JSON");
  const providerKillSwitches = new Set(readCsvEnv("MISSION_CONTROL_PROVIDER_KILL_SWITCHES"));
  const liveCosts = new Map(
    (args.billing?.providers || []).map((provider) => [provider.providerId, provider.monthlyCostUsd])
  );

  const providers: BudgetProviderInput[] = [
    {
      providerId: "openai",
      label: "OpenAI",
      actualUsd: liveCosts.get("openai") ?? null,
      estimatedUsd:
        liveCosts.get("openai") === null && args.secretStatus.openaiKey !== "missing"
          ? providerEstimates.openai ?? 24
          : 0,
      unreconciledUsd: providerUnreconciled.openai ?? 0,
      hardLimitUsd: providerBudgets.openai ?? null,
      writeEnabled: args.secretStatus.openaiKey !== "missing",
      killSwitchEnabled: providerKillSwitches.has("openai"),
    },
    {
      providerId: "google",
      label: "Google",
      actualUsd: null,
      estimatedUsd: args.googleConnected ? providerEstimates.google ?? 0 : 0,
      unreconciledUsd: providerUnreconciled.google ?? 0,
      hardLimitUsd: providerBudgets.google ?? null,
      writeEnabled: args.googleConnected,
      killSwitchEnabled: providerKillSwitches.has("google"),
    },
    {
      providerId: "twilio",
      label: "Twilio",
      actualUsd: liveCosts.get("twilio") ?? null,
      estimatedUsd:
        liveCosts.get("twilio") === null && args.secretStatus.twilioSid !== "missing"
          ? providerEstimates.twilio ?? 12
          : 0,
      unreconciledUsd: providerUnreconciled.twilio ?? 0,
      hardLimitUsd: providerBudgets.twilio ?? null,
      writeEnabled:
        args.secretStatus.twilioSid !== "missing" &&
        args.secretStatus.twilioToken !== "missing" &&
        args.secretStatus.twilioPhoneNumber !== "missing",
      killSwitchEnabled: providerKillSwitches.has("twilio"),
    },
    {
      providerId: "elevenlabs",
      label: "ElevenLabs",
      actualUsd: liveCosts.get("elevenlabs") ?? null,
      estimatedUsd:
        liveCosts.get("elevenlabs") === null && args.secretStatus.elevenLabsKey !== "missing"
          ? providerEstimates.elevenlabs ?? 16
          : 0,
      unreconciledUsd: providerUnreconciled.elevenlabs ?? 0,
      hardLimitUsd: providerBudgets.elevenlabs ?? null,
      writeEnabled: args.secretStatus.elevenLabsKey !== "missing",
      killSwitchEnabled: providerKillSwitches.has("elevenlabs"),
    },
    {
      providerId: "heygen",
      label: "HeyGen",
      actualUsd: null,
      estimatedUsd:
        args.secretStatus.heyGenKey !== "missing" ? providerEstimates.heygen ?? 0 : 0,
      unreconciledUsd: providerUnreconciled.heygen ?? 0,
      hardLimitUsd: providerBudgets.heygen ?? null,
      writeEnabled: args.secretStatus.heyGenKey !== "missing",
      killSwitchEnabled: providerKillSwitches.has("heygen"),
    },
    {
      providerId: "apify",
      label: "Apify",
      actualUsd: null,
      estimatedUsd: providerEstimates.apify ?? 0,
      unreconciledUsd: providerUnreconciled.apify ?? 0,
      hardLimitUsd: providerBudgets.apify ?? null,
      writeEnabled: Boolean(asString(process.env.APIFY_API_TOKEN)),
      killSwitchEnabled: providerKillSwitches.has("apify"),
    },
    {
      providerId: "firecrawl",
      label: "Firecrawl",
      actualUsd: null,
      estimatedUsd:
        args.secretStatus.firecrawlKey !== "missing" ? providerEstimates.firecrawl ?? 7 : 0,
      unreconciledUsd: providerUnreconciled.firecrawl ?? 0,
      hardLimitUsd: providerBudgets.firecrawl ?? null,
      writeEnabled: args.secretStatus.firecrawlKey !== "missing",
      killSwitchEnabled: providerKillSwitches.has("firecrawl"),
    },
    {
      providerId: "meta_ads",
      label: "Meta Ads",
      actualUsd: null,
      estimatedUsd: providerEstimates.meta_ads ?? 0,
      unreconciledUsd: providerUnreconciled.meta_ads ?? 0,
      hardLimitUsd: providerBudgets.meta_ads ?? null,
      writeEnabled: readBooleanEnv("META_ADS_WRITE_ENABLED"),
      killSwitchEnabled: providerKillSwitches.has("meta_ads"),
    },
    {
      providerId: "google_ads",
      label: "Google Ads",
      actualUsd: null,
      estimatedUsd: providerEstimates.google_ads ?? 0,
      unreconciledUsd: providerUnreconciled.google_ads ?? 0,
      hardLimitUsd: providerBudgets.google_ads ?? null,
      writeEnabled: readBooleanEnv("GOOGLE_ADS_WRITE_ENABLED"),
      killSwitchEnabled: providerKillSwitches.has("google_ads"),
    },
    {
      providerId: "square",
      label: "Square",
      actualUsd: null,
      estimatedUsd: providerEstimates.square ?? 0,
      unreconciledUsd: providerUnreconciled.square ?? 0,
      hardLimitUsd: providerBudgets.square ?? null,
      writeEnabled: Boolean(asString(process.env.SQUARE_ACCESS_TOKEN)),
      killSwitchEnabled: providerKillSwitches.has("square"),
    },
  ];

  const monthToDateTotal = providers.reduce((sum, provider) => {
    return (
      sum +
      Math.max(0, Number(provider.actualUsd || 0)) +
      Math.max(0, Number(provider.estimatedUsd || 0)) +
      Math.max(0, Number(provider.unreconciledUsd || 0))
    );
  }, 0);

  return {
    mode:
      asString(process.env.MISSION_CONTROL_BUDGET_MODE).toLowerCase() === "observe"
        ? "observe"
        : "hard-stop",
    monthBudgetUsd: readNumberEnv("MISSION_CONTROL_MONTHLY_BUDGET_USD"),
    projectedMonthEndUsd:
      readNumberEnv("MISSION_CONTROL_PROJECTED_MONTH_END_USD") ?? projectMonthEndUsd(monthToDateTotal),
    providers,
    globalKillSwitchEnabled: readBooleanEnv("MISSION_CONTROL_GLOBAL_KILL_SWITCH"),
  };
}

function buildMobileOpsInput(paperclip: PaperclipControlSnapshot): MobileOpsInput {
  const deepLinkBaseUrl =
    asString(process.env.NEXT_PUBLIC_APP_URL) ||
    asString(process.env.SOCIAL_DRAFT_APPROVAL_BASE_URL) ||
    null;
  const googleSpaceReady = [
    "GOOGLE_CHAT_MKT_SOCIAL_WEBHOOK_URL",
    "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL",
    "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RTS",
    "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_RNG",
    "SOCIAL_DRAFT_GOOGLE_CHAT_WEBHOOK_URL_AICF",
  ].some((name) => Boolean(asString(process.env[name])));

  return {
    deepLinkBaseUrl,
    googleSpaceReady,
    lifecycleActionsEnabled: paperclip.canProxyActions,
  };
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
    paperclipEndpoint: read("PAPERCLIP_SYSTEM_URL") || read("PAPERCLIP_MCP_SERVER_URL"),
    openClawSyncGeneratedAt: null,
    openClawSyncTargetRoot: null,
    openClawSyncManifestPath: null,
    openClawSyncStaleHours: null,
  };
}

async function readOpenClawSyncStatus(
  log: { warn: (msg: string, data?: Record<string, unknown>) => void }
): Promise<
  Pick<
    ControlPlaneExternalToolInput,
    | "openClawSyncGeneratedAt"
    | "openClawSyncTargetRoot"
    | "openClawSyncManifestPath"
    | "openClawSyncStaleHours"
  >
> {
  const targetRoot = asString(process.env.AI_HELL_MARY_ROOT) || "C:\\CTO Projects\\AI_HELL_MARY";
  const manifestPath = path.join(
    targetRoot,
    "docs",
    "generated",
    "mission-control",
    "sync-manifest.json"
  );

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const generatedAt = toIso(parsed.generatedAt);
    const generatedMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
    const staleHours =
      Number.isFinite(generatedMs)
        ? Math.max(0, Math.floor((Date.now() - generatedMs) / (60 * 60 * 1000)))
        : null;

    return {
      openClawSyncGeneratedAt: generatedAt,
      openClawSyncTargetRoot: asString(parsed.targetRoot) || targetRoot,
      openClawSyncManifestPath: manifestPath,
      openClawSyncStaleHours: staleHours,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code && err.code !== "ENOENT") {
      log.warn("agents.control_plane.openclaw_sync_unavailable", {
        manifestPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      openClawSyncGeneratedAt: null,
      openClawSyncTargetRoot: targetRoot,
      openClawSyncManifestPath: manifestPath,
      openClawSyncStaleHours: null,
    };
  }
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
  const outcomeGates = (row.outcomeGates || {}) as Record<string, unknown>;
  const outcomeGateSummary = (outcomeGates.summary || {}) as Record<string, unknown>;
  const criticalFailures = Array.isArray(outcomeGates.criticalGateFailures)
    ? outcomeGates.criticalGateFailures
        .map((value) => asString(value))
        .filter(
          (value): value is "throughput" | "revenue" =>
            value === "throughput" || value === "revenue"
        )
    : [];

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
    outcomeGates:
      Object.keys(outcomeGates).length > 0
        ? {
            summary: {
              passCount: asNumber(outcomeGateSummary.passCount),
              warnCount: asNumber(outcomeGateSummary.warnCount),
              failCount: asNumber(outcomeGateSummary.failCount),
              passOrWarnCount: asNumber(outcomeGateSummary.passOrWarnCount),
            },
            criticalGateFailures: criticalFailures,
          }
        : null,
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
      openClawSync,
      paperclip,
      customerProjection,
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
        readOpenClawSyncStatus(log),
        readPaperclipSummary(log),
        readCustomerProjection(user.uid, log),
      ]);

    const [quota, alerts] = await Promise.all([
      getLeadRunQuotaSummary(orgId),
      listLeadRunAlerts(orgId, 10),
    ]);

    const google = deriveGoogleCapabilities(googleTokens?.scope || null);
    if (!google.connected && (googleTokens?.refreshToken || googleTokens?.accessToken)) {
      google.connected = true;
    }
    const externalTools = {
      ...readExternalToolConfig(),
      ...openClawSync,
    };
    const budgetGovernor = buildBudgetGovernorInput({
      secretStatus,
      googleConnected: google.connected,
      billing,
    });
    const providerKillSwitches = readCsvEnv("MISSION_CONTROL_PROVIDER_KILL_SWITCHES");
    const businessKillSwitches = readCsvEnv("MISSION_CONTROL_BUSINESS_KILL_SWITCHES");
    const mobileOps = buildMobileOpsInput(paperclip);

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
      paperclip,
      governance: {
        globalKillSwitchEnabled: readBooleanEnv("MISSION_CONTROL_GLOBAL_KILL_SWITCH"),
        providerKillSwitches,
        businessKillSwitches,
        approvalRequiredClasses: [
          "public_facing",
          "financial_or_credentialed",
          "spend_bearing",
        ],
      },
      budgetGovernor,
      customerMemory: {
        sourceOfTruth: customerProjection.sourceOfTruth,
        knownContacts: customerProjection.knownContacts,
        recentTimelineEvents:
          customerProjection.recentTimelineEvents +
          (socialPipeline?.draftsPendingApproval || 0) +
          (socialPipeline?.dispatchPendingExternalTool || 0),
        lastTimelineAt: newestIso([
          customerProjection.lastTimelineAt,
          socialPipeline?.lastDispatchSuccessAt || null,
          posWorker?.lastWebhookAt || null,
        ]),
        emailReady: google.gmail,
        smsReady:
          secretStatus.twilioSid !== "missing" &&
          secretStatus.twilioToken !== "missing" &&
          secretStatus.twilioPhoneNumber !== "missing",
        voiceReady:
          secretStatus.twilioSid !== "missing" &&
          secretStatus.twilioToken !== "missing" &&
          secretStatus.twilioPhoneNumber !== "missing" &&
          secretStatus.elevenLabsKey !== "missing",
        calendarReady: google.calendar,
        socialReady: Boolean(socialPipeline),
        posReady: Boolean(posWorker),
        paidAdsReady:
          readBooleanEnv("META_ADS_WRITE_ENABLED") || readBooleanEnv("GOOGLE_ADS_WRITE_ENABLED"),
        duplicateProtection: true,
        dncProtection: true,
      },
      productCatalog: {
        catalogSource: "mission-control.offer-definitions",
        businessUnitCount: BUSINESS_UNIT_OPTIONS.length,
        activeOfferCount: OFFER_DEFINITIONS.length,
        approvalGated: true,
      },
      adOps: {
        metaAdsConfigured:
          Boolean(asString(process.env.META_ADS_CONTROL_URL)) ||
          Boolean(asString(process.env.META_ADS_ACCOUNT_ID)),
        googleAdsConfigured:
          Boolean(asString(process.env.GOOGLE_ADS_CONTROL_URL)) ||
          Boolean(asString(process.env.GOOGLE_ADS_CUSTOMER_ID)),
        metaAdsWriteEnabled: readBooleanEnv("META_ADS_WRITE_ENABLED"),
        googleAdsWriteEnabled: readBooleanEnv("GOOGLE_ADS_WRITE_ENABLED"),
        approvalGated: true,
      },
      mobileOps,
      reliability: {
        targetSloPct: readNumberEnv("MISSION_CONTROL_SLO_TARGET_PCT") ?? 99.9,
        primaryRegion: asString(process.env.MISSION_CONTROL_PRIMARY_REGION) || null,
        failoverRegion: asString(process.env.MISSION_CONTROL_FAILOVER_REGION) || null,
        healthEndpointEnabled: true,
      },
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
      paperclipConfigured: isValidHttpUrl(externalTools.paperclipEndpoint),
      paperclipReachable: snapshot.business.paperclip.reachable,
      paperclipProxyActions: snapshot.business.paperclip.canProxyActions,
      openClawSyncGeneratedAt: externalTools.openClawSyncGeneratedAt,
      posWorkerHealth: posWorker?.health || "unknown",
      posWorkerQueued: posWorker?.queuedEvents ?? null,
      socialDispatchPending: snapshot.operations.socialDispatch.pendingExternalTool,
      socialDispatchFailed: snapshot.operations.socialDispatch.failedDispatch,
      queueHealth: snapshot.operations.queueHealth.state,
      revenueKpiState: snapshot.operations.revenueKpi.state,
      revenueKpiWeek: snapshot.operations.revenueKpi.weekStartDate,
      budgetGovernorState: snapshot.business.budgetGovernor.state,
      customerMemoryState: snapshot.business.customerMemory.state,
      adOpsState: snapshot.business.adOps.state,
      mobileOpsState: snapshot.business.mobileOps.state,
      reliabilityState: snapshot.business.reliability.state,
    });

    return NextResponse.json(snapshot);
  },
  { route: "agents.control-plane" }
);
