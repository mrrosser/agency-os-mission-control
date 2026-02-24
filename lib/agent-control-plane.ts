import type { SecretStatus } from "@/lib/api/secrets";
import type { AgentSpaceStatus } from "@/lib/agent-status";
import type { LeadRunAlert, LeadRunQuotaSummary } from "@/lib/lead-runs/quotas";

export type ControlPlaneHealth = "operational" | "degraded" | "offline";
export type AgentRuntimeState = "active" | "idle" | "degraded" | "inactive";

export interface ControlPlaneGoogleCapabilities {
  connected: boolean;
  drive: boolean;
  gmail: boolean;
  calendar: boolean;
}

export interface ControlPlaneTelemetryGroup {
  fingerprint: string;
  kind: string;
  count: number;
  message: string;
  route: string;
  triageStatus: string;
  triageIssueUrl: string | null;
  lastSeenAt: string | null;
}

export interface ControlPlaneDriveSummary {
  lastRunAt: string | null;
  staleDays: number | null;
  lastResultCount: number;
}

export type ControlPlaneBillingProviderId = "openai" | "twilio" | "elevenlabs";
export type ControlPlaneBillingProviderStatus =
  | "live"
  | "missing_credentials"
  | "unauthorized"
  | "unavailable"
  | "error";

export interface ControlPlaneBillingProviderSnapshot {
  providerId: ControlPlaneBillingProviderId;
  label: string;
  status: ControlPlaneBillingProviderStatus;
  monthlyCostUsd: number | null;
  currency: string | null;
  detail: string;
  source: string;
}

export interface ControlPlaneBillingInput {
  capturedAt: string;
  providers: ControlPlaneBillingProviderSnapshot[];
}

export interface ControlPlaneSkillHealthInput {
  knowledgePackPresent: boolean;
  hasAgentTopology: boolean;
  hasKnowledgeIngestionPolicy: boolean;
  hasVoiceOpsPolicy: boolean;
}

export interface ControlPlaneServiceSnapshot {
  id: string;
  label: string;
  state: ControlPlaneHealth;
  detail: string;
  required: boolean;
  monthlyCostUsd: number;
}

export interface ControlPlaneAgentSnapshot {
  id: string;
  label: string;
  role: string;
  businessId: string | null;
  state: AgentRuntimeState;
  lastSeenAt: string | null;
  channels: string[];
  estimatedMonthlyCostUsd: number;
  blockedBy: string[];
}

export interface ControlPlaneSkillSnapshot {
  id: string;
  label: string;
  state: ControlPlaneHealth;
  detail: string;
}

export interface ControlPlaneBugSnapshot {
  fingerprint: string;
  count: number;
  message: string;
  route: string;
  triageStatus: string;
  triageIssueUrl: string | null;
  lastSeenAt: string | null;
}

export interface ControlPlaneAlertSnapshot {
  alertId: string;
  runId: string;
  title: string;
  message: string;
  status: "open" | "acked";
  severity: string;
  createdAt: string | null;
}

export interface ControlPlaneSnapshot {
  generatedAt: string;
  summary: {
    health: ControlPlaneHealth;
    activeAgents: number;
    degradedAgents: number;
    inactiveAgents: number;
    openAlerts: number;
    unresolvedBugs: number;
    projectedMonthlyCostUsd: number;
  };
  quota: {
    orgId: string;
    runsUsed: number;
    maxRunsPerDay: number;
    leadsUsed: number;
    maxLeadsPerDay: number;
    activeRuns: number;
    maxActiveRuns: number;
  };
  agents: ControlPlaneAgentSnapshot[];
  services: ControlPlaneServiceSnapshot[];
  skills: ControlPlaneSkillSnapshot[];
  diagnostics: {
    bugs: ControlPlaneBugSnapshot[];
    alerts: ControlPlaneAlertSnapshot[];
    recommendations: string[];
  };
  costModel: {
    method: "heuristic-v1" | "hybrid-v1" | "live-v1";
    assumptions: string[];
    serviceCostUsd: number;
    agentCostUsd: number;
    liveProviderCostUsd: number;
    providerBilling: ControlPlaneBillingProviderSnapshot[];
  };
}

interface BuildControlPlaneSnapshotInput {
  nowIso?: string;
  spaces: Record<string, AgentSpaceStatus>;
  secretStatus: SecretStatus;
  google: ControlPlaneGoogleCapabilities;
  quota: LeadRunQuotaSummary;
  alerts: LeadRunAlert[];
  telemetryGroups: ControlPlaneTelemetryGroup[];
  driveSummary: ControlPlaneDriveSummary;
  skillHealth: ControlPlaneSkillHealthInput;
  billing?: ControlPlaneBillingInput;
}

type ServiceKey =
  | "openai_brain"
  | "google_workspace"
  | "gmail_tooling"
  | "calendar_tooling"
  | "drive_knowledge"
  | "twilio_voice"
  | "elevenlabs_tts"
  | "firecrawl_research";

const PROVIDER_TO_SERVICE: Record<ControlPlaneBillingProviderId, ServiceKey> = {
  openai: "openai_brain",
  twilio: "twilio_voice",
  elevenlabs: "elevenlabs_tts",
};

const AGENT_DEFINITIONS: Array<{
  id: string;
  label: string;
  role: string;
  businessId: string | null;
  baseMonthlyCostUsd: number;
  requiredServices: ServiceKey[];
  aliases: string[];
}> = [
  {
    id: "orchestrator",
    label: "Master Orchestrator",
    role: "router",
    businessId: null,
    baseMonthlyCostUsd: 26,
    requiredServices: ["openai_brain"],
    aliases: ["main", "default", "coding"],
  },
  {
    id: "biz-aicf",
    label: "AI CoFoundry Agent",
    role: "business-specialist",
    businessId: "ai_cofoundry",
    baseMonthlyCostUsd: 14,
    requiredServices: ["openai_brain", "google_workspace"],
    aliases: ["biz_aicf"],
  },
  {
    id: "biz-rng",
    label: "RNG Agent",
    role: "business-specialist",
    businessId: "rosser_nft_gallery",
    baseMonthlyCostUsd: 14,
    requiredServices: ["openai_brain", "google_workspace"],
    aliases: ["biz_rng"],
  },
  {
    id: "biz-rts",
    label: "RT Solutions Agent",
    role: "business-specialist",
    businessId: "rt_solutions",
    baseMonthlyCostUsd: 14,
    requiredServices: ["openai_brain", "google_workspace"],
    aliases: ["biz_rts"],
  },
  {
    id: "fn-marketing",
    label: "Marketing Agent",
    role: "function-specialist",
    businessId: null,
    baseMonthlyCostUsd: 11,
    requiredServices: ["openai_brain"],
    aliases: ["fn_marketing"],
  },
  {
    id: "fn-research",
    label: "Research Agent",
    role: "function-specialist",
    businessId: null,
    baseMonthlyCostUsd: 11,
    requiredServices: ["openai_brain", "firecrawl_research"],
    aliases: ["fn_research"],
  },
  {
    id: "fn-actions",
    label: "Action Executor",
    role: "writer",
    businessId: null,
    baseMonthlyCostUsd: 16,
    requiredServices: ["gmail_tooling", "calendar_tooling", "google_workspace"],
    aliases: ["fn_actions"],
  },
];

const ACTIVITY_MULTIPLIER: Record<AgentRuntimeState, number> = {
  active: 1,
  idle: 0.62,
  degraded: 0.8,
  inactive: 0.28,
};

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapAgentAliases(agentId: string): string {
  const normalized = agentId.trim().toLowerCase();
  for (const def of AGENT_DEFINITIONS) {
    if (def.id === normalized) return def.id;
    if (def.aliases.includes(normalized)) return def.id;
  }
  return normalized;
}

function resolveServiceState(
  id: ServiceKey,
  secretStatus: SecretStatus,
  google: ControlPlaneGoogleCapabilities,
  driveSummary: ControlPlaneDriveSummary
): ControlPlaneServiceSnapshot {
  if (id === "openai_brain") {
    const hasKey = secretStatus.openaiKey !== "missing";
    return {
      id,
      label: "OpenAI Brain",
      state: hasKey ? "operational" : "offline",
      detail: hasKey ? "API key configured" : "Missing OPENAI key",
      required: true,
      monthlyCostUsd: hasKey ? 24 : 0,
    };
  }

  if (id === "google_workspace") {
    if (!google.connected) {
      return {
        id,
        label: "Google Workspace Auth",
        state: "offline",
        detail: "Google account not connected",
        required: true,
        monthlyCostUsd: 0,
      };
    }

    const enabledCount = [google.gmail, google.calendar, google.drive].filter(Boolean).length;
    if (enabledCount === 3) {
      return {
        id,
        label: "Google Workspace Auth",
        state: "operational",
        detail: "Gmail + Calendar + Drive scopes active",
        required: true,
        monthlyCostUsd: 0,
      };
    }

    return {
      id,
      label: "Google Workspace Auth",
      state: "degraded",
      detail: `Partial scopes connected (${enabledCount}/3)`,
      required: true,
      monthlyCostUsd: 0,
    };
  }

  if (id === "gmail_tooling") {
    return {
      id,
      label: "Gmail Tooling",
      state: google.gmail ? "operational" : "offline",
      detail: google.gmail ? "Draft + thread access available" : "Missing Gmail scope",
      required: true,
      monthlyCostUsd: 0,
    };
  }

  if (id === "calendar_tooling") {
    return {
      id,
      label: "Calendar Tooling",
      state: google.calendar ? "operational" : "offline",
      detail: google.calendar ? "Scheduling access available" : "Missing Calendar scope",
      required: true,
      monthlyCostUsd: 0,
    };
  }

  if (id === "drive_knowledge") {
    const baseState: ControlPlaneHealth = google.drive ? "operational" : "offline";
    const staleDays = driveSummary.staleDays;
    if (baseState === "offline") {
      return {
        id,
        label: "Drive Knowledge Sync",
        state: "offline",
        detail: "Missing Drive scope",
        required: false,
        monthlyCostUsd: 0,
      };
    }
    if (staleDays === null) {
      return {
        id,
        label: "Drive Knowledge Sync",
        state: "degraded",
        detail: "No delta scan run yet",
        required: false,
        monthlyCostUsd: 0,
      };
    }
    if (staleDays > 7) {
      return {
        id,
        label: "Drive Knowledge Sync",
        state: "degraded",
        detail: `Last delta scan ${staleDays} days ago`,
        required: false,
        monthlyCostUsd: 0,
      };
    }
    return {
      id,
      label: "Drive Knowledge Sync",
      state: "operational",
      detail: `Last delta scan ${staleDays} day(s) ago`,
      required: false,
      monthlyCostUsd: 0,
    };
  }

  if (id === "twilio_voice") {
    const twilioReady =
      secretStatus.twilioSid !== "missing" &&
      secretStatus.twilioToken !== "missing" &&
      secretStatus.twilioPhoneNumber !== "missing";
    return {
      id,
      label: "Twilio Voice/SMS",
      state: twilioReady ? "operational" : "offline",
      detail: twilioReady ? "SID + token + number configured" : "Missing Twilio credentials",
      required: false,
      monthlyCostUsd: twilioReady ? 12 : 0,
    };
  }

  if (id === "elevenlabs_tts") {
    const ready = secretStatus.elevenLabsKey !== "missing";
    return {
      id,
      label: "ElevenLabs TTS",
      state: ready ? "operational" : "offline",
      detail: ready ? "Voice synthesis key configured" : "Missing ElevenLabs API key",
      required: false,
      monthlyCostUsd: ready ? 16 : 0,
    };
  }

  const firecrawlReady = secretStatus.firecrawlKey !== "missing";
  return {
    id,
    label: "Research Enrichment",
    state: firecrawlReady ? "operational" : "degraded",
    detail: firecrawlReady ? "Firecrawl API key configured" : "No Firecrawl key (research fallback mode)",
    required: false,
    monthlyCostUsd: firecrawlReady ? 7 : 0,
  };
}

function deriveRuntimeState(lastSeenAt: string | null, nowMs: number): AgentRuntimeState {
  const lastSeenMs = parseIso(lastSeenAt);
  if (lastSeenMs === null) return "inactive";
  const deltaMinutes = Math.max(0, Math.floor((nowMs - lastSeenMs) / 60000));
  if (deltaMinutes <= 15) return "active";
  if (deltaMinutes <= 24 * 60) return "idle";
  return "inactive";
}

function applyProviderBilling(
  services: ControlPlaneServiceSnapshot[],
  providers: ControlPlaneBillingProviderSnapshot[]
): {
  providerCount: number;
  liveProviderCount: number;
  liveProviderCostUsd: number;
} {
  const providerByService = new Map<ServiceKey, ControlPlaneBillingProviderSnapshot>();
  for (const provider of providers) {
    const serviceId = PROVIDER_TO_SERVICE[provider.providerId];
    if (!serviceId) continue;
    providerByService.set(serviceId, provider);
  }

  let liveProviderCount = 0;
  let liveProviderCostUsd = 0;

  for (const service of services) {
    const provider = providerByService.get(service.id as ServiceKey);
    if (!provider) continue;

    if (provider.status === "live" && typeof provider.monthlyCostUsd === "number") {
      const billed = roundUsd(provider.monthlyCostUsd);
      service.monthlyCostUsd = billed;
      service.detail = `${service.detail} | Billing API: $${billed.toFixed(2)} this month`;
      liveProviderCount += 1;
      liveProviderCostUsd += billed;
      continue;
    }

    if (provider.status !== "missing_credentials") {
      service.detail = `${service.detail} | Billing API: ${provider.status}`;
    }
  }

  return {
    providerCount: providers.length,
    liveProviderCount,
    liveProviderCostUsd: roundUsd(liveProviderCostUsd),
  };
}

function createSkillSnapshots(input: ControlPlaneSkillHealthInput): ControlPlaneSkillSnapshot[] {
  return [
    {
      id: "knowledge_pack_v2",
      label: "Knowledge Pack v2",
      state: input.knowledgePackPresent ? "operational" : "offline",
      detail: input.knowledgePackPresent ? "Knowledge pack loaded from template path" : "Knowledge pack file missing",
    },
    {
      id: "subagent_router",
      label: "Sub-Agent Router",
      state: input.hasAgentTopology ? "operational" : "degraded",
      detail: input.hasAgentTopology ? "Agent topology + handoff rules present" : "Agent topology not found in pack",
    },
    {
      id: "knowledge_ingestion",
      label: "Knowledge Ingestion Policy",
      state: input.hasKnowledgeIngestionPolicy ? "operational" : "degraded",
      detail: input.hasKnowledgeIngestionPolicy
        ? "Weekly metadata-delta policy configured"
        : "Ingestion policy missing",
    },
    {
      id: "voice_action_policy",
      label: "Voice Action Policy",
      state: input.hasVoiceOpsPolicy ? "operational" : "degraded",
      detail: input.hasVoiceOpsPolicy
        ? "Draft-first voice action guardrails configured"
        : "Voice ops guardrails missing",
    },
  ];
}

function buildRecommendations(args: {
  services: ControlPlaneServiceSnapshot[];
  alerts: LeadRunAlert[];
  unresolvedBugs: number;
  agents: ControlPlaneAgentSnapshot[];
  driveSummary: ControlPlaneDriveSummary;
}): string[] {
  const recommendations: string[] = [];
  const serviceById = new Map(args.services.map((service) => [service.id, service]));

  const openai = serviceById.get("openai_brain");
  if (openai?.state !== "operational") {
    recommendations.push("Add OpenAI API key in API Vault to bring orchestrator and business agents online.");
  }

  const google = serviceById.get("google_workspace");
  if (google?.state !== "operational") {
    recommendations.push("Reconnect Google Workspace with Gmail + Calendar + Drive scopes for full agent actions.");
  }

  const twilio = serviceById.get("twilio_voice");
  if (twilio?.state !== "operational") {
    recommendations.push("Complete Twilio SID/token/phone configuration before scaling voice + SMS actions.");
  }

  const eleven = serviceById.get("elevenlabs_tts");
  if (eleven?.state !== "operational") {
    recommendations.push("Add ElevenLabs key to keep calls in your cloned voice profile.");
  }

  if (args.driveSummary.staleDays !== null && args.driveSummary.staleDays > 7) {
    recommendations.push("Run a Drive delta scan now; knowledge sync is older than one week.");
  }

  const openAlerts = args.alerts.filter((alert) => alert.status === "open").length;
  if (openAlerts > 0) {
    recommendations.push(`Acknowledge ${openAlerts} open lead-run alert(s) and review the failing run diagnostics.`);
  }

  if (args.unresolvedBugs > 0) {
    recommendations.push(`Triage ${args.unresolvedBugs} unresolved telemetry bug group(s) in Operations.`);
  }

  const degradedAgents = args.agents.filter((agent) => agent.state === "degraded").length;
  if (degradedAgents > 0) {
    recommendations.push(`Resolve service dependencies for ${degradedAgents} degraded agent(s) to restore full automation.`);
  }

  if (recommendations.length === 0) {
    recommendations.push("System looks healthy. Next step: run weekly live call + draft + calendar smoke tests.");
  }

  return recommendations.slice(0, 6);
}

export function buildControlPlaneSnapshot(input: BuildControlPlaneSnapshotInput): ControlPlaneSnapshot {
  const generatedAt = input.nowIso || new Date().toISOString();
  const nowMs = parseIso(generatedAt) || Date.now();

  const serviceList: ControlPlaneServiceSnapshot[] = [
    resolveServiceState("openai_brain", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("google_workspace", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("gmail_tooling", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("calendar_tooling", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("drive_knowledge", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("twilio_voice", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("elevenlabs_tts", input.secretStatus, input.google, input.driveSummary),
    resolveServiceState("firecrawl_research", input.secretStatus, input.google, input.driveSummary),
  ];
  const providerBilling = input.billing?.providers || [];
  const billingRollup = applyProviderBilling(serviceList, providerBilling);
  const serviceMap = new Map(serviceList.map((service) => [service.id as ServiceKey, service]));

  const channelsByAgent = new Map<string, Set<string>>();
  const latestSeenByAgent = new Map<string, string | null>();

  for (const [spaceId, status] of Object.entries(input.spaces)) {
    const mappedAgentId = mapAgentAliases(status.agentId || "");
    if (!channelsByAgent.has(mappedAgentId)) channelsByAgent.set(mappedAgentId, new Set<string>());
    channelsByAgent.get(mappedAgentId)?.add(spaceId);
    const existing = latestSeenByAgent.get(mappedAgentId);
    const currentIso = status.updatedAt || null;
    if (!existing) {
      latestSeenByAgent.set(mappedAgentId, currentIso);
      continue;
    }
    const existingMs = parseIso(existing);
    const currentMs = parseIso(currentIso);
    if (currentMs !== null && (existingMs === null || currentMs > existingMs)) {
      latestSeenByAgent.set(mappedAgentId, currentIso);
    }
  }

  const agents = AGENT_DEFINITIONS.map((definition) => {
    const lastSeenAt = latestSeenByAgent.get(definition.id) || null;
    const baseState = deriveRuntimeState(lastSeenAt, nowMs);
    const blockedBy = definition.requiredServices
      .filter((serviceId) => serviceMap.get(serviceId)?.state !== "operational")
      .map((serviceId) => serviceMap.get(serviceId)?.label || serviceId);

    const state: AgentRuntimeState = blockedBy.length > 0 && baseState !== "inactive" ? "degraded" : baseState;
    const estimatedMonthlyCostUsd = roundUsd(definition.baseMonthlyCostUsd * ACTIVITY_MULTIPLIER[state]);

    return {
      id: definition.id,
      label: definition.label,
      role: definition.role,
      businessId: definition.businessId,
      state,
      lastSeenAt,
      channels: Array.from(channelsByAgent.get(definition.id) || []),
      estimatedMonthlyCostUsd,
      blockedBy,
    } satisfies ControlPlaneAgentSnapshot;
  });

  const bugSnapshots: ControlPlaneBugSnapshot[] = input.telemetryGroups.map((group) => ({
    fingerprint: group.fingerprint,
    count: group.count,
    message: group.message,
    route: group.route,
    triageStatus: group.triageStatus,
    triageIssueUrl: group.triageIssueUrl,
    lastSeenAt: group.lastSeenAt,
  }));

  const unresolvedBugs = bugSnapshots.filter(
    (bug) => bug.triageStatus !== "resolved" && bug.triageStatus !== "acked"
  ).length;

  const alerts = input.alerts.map((alert) => ({
    alertId: alert.alertId,
    runId: alert.runId,
    title: alert.title,
    message: alert.message,
    status: alert.status,
    severity: alert.severity,
    createdAt: alert.createdAt || null,
  }));

  const openAlerts = alerts.filter((alert) => alert.status === "open").length;
  const skills = createSkillSnapshots(input.skillHealth);
  const degradedSkills = skills.filter((skill) => skill.state !== "operational").length;

  const activeAgents = agents.filter((agent) => agent.state === "active").length;
  const degradedAgents = agents.filter((agent) => agent.state === "degraded").length;
  const inactiveAgents = agents.filter((agent) => agent.state === "inactive").length;

  const serviceCostUsd = roundUsd(serviceList.reduce((total, service) => total + service.monthlyCostUsd, 0));
  const agentCostUsd = roundUsd(agents.reduce((total, agent) => total + agent.estimatedMonthlyCostUsd, 0));
  const projectedMonthlyCostUsd = roundUsd(agentCostUsd + serviceCostUsd);
  const liveProviderCostUsd = billingRollup.liveProviderCostUsd;

  let costMethod: "heuristic-v1" | "hybrid-v1" | "live-v1" = "heuristic-v1";
  if (billingRollup.liveProviderCount > 0) {
    costMethod =
      billingRollup.liveProviderCount === billingRollup.providerCount ? "live-v1" : "hybrid-v1";
  }

  const costAssumptions =
    costMethod === "live-v1"
      ? [
          "OpenAI, Twilio, and ElevenLabs costs are pulled from provider billing APIs for this month.",
          "Agent compute is still estimated from runtime state (active/idle/degraded/inactive).",
        ]
      : costMethod === "hybrid-v1"
        ? [
            `Live billing data is available for ${billingRollup.liveProviderCount}/${billingRollup.providerCount} providers.`,
            "Providers without live billing fall back to heuristic service defaults.",
            "Agent compute is estimated from runtime state (active/idle/degraded/inactive).",
          ]
        : [
            "Per-agent cost is heuristic based on runtime state (active/idle/degraded/inactive).",
            "Service cost is estimated from enabled integrations only (Twilio, ElevenLabs, OpenAI, Firecrawl).",
            "No live provider billing data available in this snapshot.",
          ];

  const operationalServices = serviceList.filter((service) => service.state === "operational").length;
  const requiredServiceFailures = serviceList.filter((service) => service.required && service.state !== "operational");

  let health: ControlPlaneHealth = "operational";
  if (requiredServiceFailures.length > 0) {
    health = "offline";
  } else if (degradedAgents > 0 || openAlerts > 0 || unresolvedBugs > 0 || degradedSkills > 0) {
    health = "degraded";
  } else if (operationalServices === 0) {
    health = "offline";
  }

  const recommendations = buildRecommendations({
    services: serviceList,
    alerts: input.alerts,
    unresolvedBugs,
    agents,
    driveSummary: input.driveSummary,
  });

  return {
    generatedAt,
    summary: {
      health,
      activeAgents,
      degradedAgents,
      inactiveAgents,
      openAlerts,
      unresolvedBugs,
      projectedMonthlyCostUsd,
    },
    quota: {
      orgId: input.quota.orgId,
      runsUsed: input.quota.runsUsed,
      maxRunsPerDay: input.quota.maxRunsPerDay,
      leadsUsed: input.quota.leadsUsed,
      maxLeadsPerDay: input.quota.maxLeadsPerDay,
      activeRuns: input.quota.activeRuns,
      maxActiveRuns: input.quota.maxActiveRuns,
    },
    agents,
    services: serviceList,
    skills,
    diagnostics: {
      bugs: bugSnapshots.slice(0, 8),
      alerts: alerts.slice(0, 8),
      recommendations,
    },
    costModel: {
      method: costMethod,
      assumptions: costAssumptions,
      serviceCostUsd,
      agentCostUsd,
      liveProviderCostUsd,
      providerBilling,
    },
  };
}
