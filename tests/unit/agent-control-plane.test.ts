import { describe, expect, it } from "vitest";
import { buildControlPlaneSnapshot } from "@/lib/agent-control-plane";
import type { SecretStatus } from "@/lib/api/secrets";
import type { GovernanceInput } from "@/lib/control-plane/autonomous-business";

const ALL_MISSING: SecretStatus = {
  openaiKey: "missing",
  twilioSid: "missing",
  twilioToken: "missing",
  twilioPhoneNumber: "missing",
  elevenLabsKey: "missing",
  heyGenKey: "missing",
  googlePlacesKey: "missing",
  firecrawlKey: "missing",
  googlePickerApiKey: "missing",
};

const NO_EXTERNAL_TOOLS = {
  smAutoEndpoint: null,
  leadOpsEndpoint: null,
  paperclipEndpoint: null,
  openClawSyncGeneratedAt: null,
  openClawSyncTargetRoot: null,
  openClawSyncManifestPath: null,
  openClawSyncStaleHours: null,
} as const;

const DEFAULT_PAPERCLIP = {
  state: "degraded" as const,
  configured: false,
  reachable: false,
  canProxyActions: false,
  baseUrl: null,
  sourceOfTruth: "mission_control" as const,
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

const DEFAULT_GOVERNANCE: GovernanceInput = {
  globalKillSwitchEnabled: false,
  providerKillSwitches: [],
  businessKillSwitches: [],
  approvalRequiredClasses: [
    "public_facing",
    "financial_or_credentialed",
    "spend_bearing",
  ],
};

const DEFAULT_BUDGET = {
  mode: "hard-stop" as const,
  monthBudgetUsd: 500,
  projectedMonthEndUsd: 120,
  globalKillSwitchEnabled: false,
  providers: [],
};

const DEFAULT_CUSTOMER_MEMORY = {
  sourceOfTruth: "firestore_projected" as const,
  knownContacts: 12,
  recentTimelineEvents: 6,
  lastTimelineAt: "2026-02-16T17:58:00.000Z",
  emailReady: false,
  smsReady: false,
  voiceReady: false,
  calendarReady: false,
  socialReady: false,
  posReady: false,
  paidAdsReady: false,
  duplicateProtection: true,
  dncProtection: true,
};

const DEFAULT_PRODUCT_CATALOG = {
  catalogSource: "mission-control.offer-definitions",
  businessUnitCount: 3,
  activeOfferCount: 9,
  approvalGated: true,
};

const DEFAULT_AD_OPS = {
  metaAdsConfigured: false,
  googleAdsConfigured: false,
  metaAdsWriteEnabled: false,
  googleAdsWriteEnabled: false,
  approvalGated: true,
};

const DEFAULT_MOBILE_OPS = {
  deepLinkBaseUrl: "https://leadflow-review.web.app",
  googleSpaceReady: true,
  lifecycleActionsEnabled: false,
};

const DEFAULT_RELIABILITY = {
  targetSloPct: 99.9,
  primaryRegion: "us-central1",
  failoverRegion: "us-east1",
  healthEndpointEnabled: true,
};

describe("buildControlPlaneSnapshot", () => {
  it("marks system offline when required services are missing", () => {
    const snapshot = buildControlPlaneSnapshot({
      nowIso: "2026-02-16T18:00:00.000Z",
      spaces: {},
      secretStatus: ALL_MISSING,
      google: { connected: false, drive: false, gmail: false, calendar: false },
      quota: {
        orgId: "org-1",
        windowKey: "2026-02-16",
        runsUsed: 0,
        leadsUsed: 0,
        activeRuns: 0,
        maxRunsPerDay: 80,
        maxLeadsPerDay: 1200,
        maxActiveRuns: 3,
        runsRemaining: 80,
        leadsRemaining: 1200,
        utilization: { runsPct: 0, leadsPct: 0 },
      },
      alerts: [],
      telemetryGroups: [],
      driveSummary: { lastRunAt: null, staleDays: null, lastResultCount: 0 },
      skillHealth: {
        knowledgePackPresent: false,
        hasAgentTopology: false,
        hasKnowledgeIngestionPolicy: false,
        hasVoiceOpsPolicy: false,
      },
      externalTools: NO_EXTERNAL_TOOLS,
      posWorker: null,
      paperclip: DEFAULT_PAPERCLIP,
      governance: DEFAULT_GOVERNANCE,
      budgetGovernor: DEFAULT_BUDGET,
      customerMemory: DEFAULT_CUSTOMER_MEMORY,
      productCatalog: DEFAULT_PRODUCT_CATALOG,
      adOps: DEFAULT_AD_OPS,
      mobileOps: DEFAULT_MOBILE_OPS,
      reliability: DEFAULT_RELIABILITY,
    });

    expect(snapshot.summary.health).toBe("offline");
    expect(snapshot.summary.activeAgents).toBe(0);
    expect(snapshot.services.find((service) => service.id === "openai_brain")?.state).toBe("offline");
    expect(snapshot.services.find((service) => service.id === "smauto_mcp")?.state).toBe("degraded");
    expect(snapshot.services.find((service) => service.id === "leadops_mcp")?.state).toBe("degraded");
    expect(snapshot.services.find((service) => service.id === "paperclip_system")?.state).toBe("degraded");
    expect(snapshot.services.find((service) => service.id === "openclaw_sync")?.state).toBe("degraded");
    expect(snapshot.services.find((service) => service.id === "square_pos")?.state).toBe("degraded");
    expect(snapshot.diagnostics.recommendations[0]).toContain("OpenAI API key");
  });

  it("marks agents active/degraded and computes projected cost", () => {
    const snapshot = buildControlPlaneSnapshot({
      nowIso: "2026-02-16T18:00:00.000Z",
      spaces: {
        "spaces/AAQA62xqRGQ": {
          agentId: "orchestrator",
          updatedAt: "2026-02-16T17:58:00.000Z",
        },
        "spaces/AAQALocqO7Q": {
          agentId: "fn-actions",
          updatedAt: "2026-02-16T17:56:00.000Z",
        },
      },
      secretStatus: {
        ...ALL_MISSING,
        openaiKey: "secret",
        twilioSid: "secret",
        twilioToken: "secret",
        twilioPhoneNumber: "secret",
        elevenLabsKey: "secret",
        firecrawlKey: "secret",
      },
      google: { connected: true, drive: true, gmail: true, calendar: true },
      quota: {
        orgId: "org-1",
        windowKey: "2026-02-16",
        runsUsed: 12,
        leadsUsed: 128,
        activeRuns: 1,
        maxRunsPerDay: 80,
        maxLeadsPerDay: 1200,
        maxActiveRuns: 3,
        runsRemaining: 68,
        leadsRemaining: 1072,
        utilization: { runsPct: 15, leadsPct: 11 },
      },
      alerts: [
        {
          alertId: "org-1_run-1",
          orgId: "org-1",
          runId: "run-1",
          uid: "user-1",
          severity: "error",
          title: "Lead run failures exceeded threshold",
          message: "One or more lead runs failed repeatedly.",
          failureStreak: 3,
          status: "open",
          createdAt: "2026-02-16T17:10:00.000Z",
        },
      ],
      telemetryGroups: [
        {
          fingerprint: "abc",
          kind: "server",
          count: 4,
          message: "Calendar 500",
          route: "/api/calendar/schedule",
          triageStatus: "new",
          triageIssueUrl: null,
          lastSeenAt: "2026-02-16T17:30:00.000Z",
        },
      ],
      driveSummary: {
        lastRunAt: "2026-02-15T18:00:00.000Z",
        staleDays: 1,
        lastResultCount: 42,
      },
      skillHealth: {
        knowledgePackPresent: true,
        hasAgentTopology: true,
        hasKnowledgeIngestionPolicy: true,
        hasVoiceOpsPolicy: true,
      },
      externalTools: {
        smAutoEndpoint: "https://smauto.example/mcp",
        leadOpsEndpoint: "https://leadops.example/mcp",
        paperclipEndpoint: "https://paperclip.example/system",
        openClawSyncGeneratedAt: "2026-02-16T16:30:00.000Z",
        openClawSyncTargetRoot: "C:\\CTO Projects\\AI_HELL_MARY",
        openClawSyncManifestPath: "C:\\CTO Projects\\AI_HELL_MARY\\docs\\generated\\mission-control\\sync-manifest.json",
        openClawSyncStaleHours: 1,
      },
      posWorker: {
        health: "operational",
        detail: "Webhook feed active and queue healthy.",
        lastWebhookAt: "2026-02-16T17:50:00.000Z",
        oldestPendingSeconds: 0,
        queuedEvents: 0,
        blockedEvents: 0,
        deadLetterEvents: 0,
        outboxQueued: 0,
      },
      runtimeChecks: [
        { id: "lead-run-queue", label: "Lead run queue", state: "ok", detail: "ready" },
        { id: "lead-run-queue-oidc", label: "Lead run OIDC", state: "ok", detail: "ready" },
        { id: "followups-queue", label: "Followups queue", state: "ok", detail: "ready" },
        { id: "competitor-monitor-queue", label: "Competitor queue", state: "ok", detail: "ready" },
      ],
      socialPipeline: {
        draftsPendingApproval: 1,
        dispatchPendingExternalTool: 0,
        dispatchFailed: 0,
        lastDispatchSuccessAt: "2026-02-16T17:58:00.000Z",
        lastDispatchFailureAt: null,
      },
      weeklyKpi: {
        weekStartDate: "2026-02-10",
        weekEndDate: "2026-02-16",
        generatedAt: "2026-02-16T17:59:00.000Z",
        leadsSourced: 12,
        closeRatePct: 16.6,
        depositsCollected: 2,
        dealsWon: 2,
        pipelineValueUsd: 7300,
        decisionSummary: {
          scale: 1,
          fix: 0,
          kill: 0,
          watch: 1,
        },
      },
      billing: {
        capturedAt: "2026-02-16T18:00:00.000Z",
        providers: [
          {
            providerId: "openai",
            label: "OpenAI",
            status: "live",
            monthlyCostUsd: 33.21,
            currency: "USD",
            detail: "Live month-to-date billing pulled from OpenAI.",
            source: "organization.costs",
          },
          {
            providerId: "twilio",
            label: "Twilio",
            status: "unavailable",
            monthlyCostUsd: null,
            currency: "USD",
            detail: "Twilio billing endpoint returned 429.",
            source: "usage.records.this_month",
          },
          {
            providerId: "elevenlabs",
            label: "ElevenLabs",
            status: "live",
            monthlyCostUsd: 9.44,
            currency: "USD",
            detail: "Live invoice amount pulled from ElevenLabs subscription endpoint.",
            source: "user.subscription",
          },
        ],
      },
      paperclip: {
        ...DEFAULT_PAPERCLIP,
        state: "operational",
        configured: true,
        reachable: true,
        canProxyActions: true,
        baseUrl: "https://paperclip.example/system",
        sourceOfTruth: "paperclip",
        companyCount: 3,
        agentCount: 12,
        activeRunCount: 4,
        detail: "Paperclip reachable.",
        capabilities: {
          lifecycleActions: true,
          heartbeats: true,
          budgets: true,
          audit: true,
          mobile: true,
        },
      },
      governance: DEFAULT_GOVERNANCE,
      budgetGovernor: {
        ...DEFAULT_BUDGET,
        projectedMonthEndUsd: 88,
        providers: [
          {
            providerId: "openai",
            label: "OpenAI",
            actualUsd: 33.21,
            estimatedUsd: 0,
            unreconciledUsd: 0,
            hardLimitUsd: 120,
            writeEnabled: true,
          },
          {
            providerId: "twilio",
            label: "Twilio",
            actualUsd: 4.2,
            estimatedUsd: 0,
            unreconciledUsd: 0,
            hardLimitUsd: 60,
            writeEnabled: true,
          },
        ],
      },
      customerMemory: {
        ...DEFAULT_CUSTOMER_MEMORY,
        sourceOfTruth: "paperclip",
        emailReady: true,
        smsReady: true,
        voiceReady: true,
        calendarReady: true,
        socialReady: true,
        posReady: true,
        paidAdsReady: true,
      },
      productCatalog: DEFAULT_PRODUCT_CATALOG,
      adOps: {
        ...DEFAULT_AD_OPS,
        metaAdsConfigured: true,
        googleAdsConfigured: true,
        metaAdsWriteEnabled: true,
        googleAdsWriteEnabled: true,
      },
      mobileOps: {
        ...DEFAULT_MOBILE_OPS,
        lifecycleActionsEnabled: true,
      },
      reliability: DEFAULT_RELIABILITY,
    });

    expect(snapshot.summary.health).toBe("degraded");
    expect(snapshot.summary.activeAgents).toBeGreaterThanOrEqual(2);
    expect(snapshot.summary.projectedMonthlyCostUsd).toBeGreaterThan(0);
    expect(snapshot.agents.find((agent) => agent.id === "orchestrator")?.state).toBe("active");
    expect(snapshot.agents.find((agent) => agent.id === "fn-actions")?.state).toBe("active");
    expect(snapshot.diagnostics.bugs[0]?.message).toContain("Calendar 500");
    expect(snapshot.diagnostics.alerts[0]?.status).toBe("open");
    expect(snapshot.costModel.method).toBe("hybrid-v1");
    expect(snapshot.costModel.liveProviderCostUsd).toBeCloseTo(42.65, 2);
    expect(snapshot.costModel.providerBilling).toHaveLength(3);
    expect(snapshot.services.find((service) => service.id === "smauto_mcp")?.state).toBe("operational");
    expect(snapshot.services.find((service) => service.id === "leadops_mcp")?.state).toBe("operational");
    expect(snapshot.services.find((service) => service.id === "paperclip_system")?.state).toBe("operational");
    expect(snapshot.services.find((service) => service.id === "openclaw_sync")?.state).toBe("operational");
    expect(snapshot.services.find((service) => service.id === "square_pos")?.state).toBe("operational");
    expect(
      snapshot.topology.find((item) => item.serviceId === "paperclip_system")?.links.some((link) => link.agentId === "orchestrator")
    ).toBe(true);
    expect(snapshot.operations.queueHealth.state).toBe("operational");
    expect(snapshot.operations.socialDispatch.state).toBe("operational");
    expect(snapshot.operations.revenueKpi.state).toBe("operational");
    expect(snapshot.operations.revenueKpi.decisionSummary.scale).toBe(1);
    expect(snapshot.business.paperclip.state).toBe("operational");
    expect(snapshot.business.budgetGovernor.mode).toBe("hard-stop");
    expect(snapshot.business.customerMemory.sourceOfTruth).toBe("paperclip");
    expect(snapshot.business.adOps.state).toBe("operational");
    expect(snapshot.business.mobileOps.supportsLifecycleActions).toBe(true);
  });

  it("marks connector services degraded when endpoint format is invalid", () => {
    const snapshot = buildControlPlaneSnapshot({
      nowIso: "2026-02-16T18:00:00.000Z",
      spaces: {},
      secretStatus: {
        ...ALL_MISSING,
        openaiKey: "secret",
      },
      google: { connected: false, drive: false, gmail: false, calendar: false },
      quota: {
        orgId: "org-1",
        windowKey: "2026-02-16",
        runsUsed: 0,
        leadsUsed: 0,
        activeRuns: 0,
        maxRunsPerDay: 80,
        maxLeadsPerDay: 1200,
        maxActiveRuns: 3,
        runsRemaining: 80,
        leadsRemaining: 1200,
        utilization: { runsPct: 0, leadsPct: 0 },
      },
      alerts: [],
      telemetryGroups: [],
      driveSummary: { lastRunAt: null, staleDays: null, lastResultCount: 0 },
      skillHealth: {
        knowledgePackPresent: true,
        hasAgentTopology: true,
        hasKnowledgeIngestionPolicy: true,
        hasVoiceOpsPolicy: true,
      },
      externalTools: {
        smAutoEndpoint: "smauto-local",
        leadOpsEndpoint: "ftp://leadops.local",
        paperclipEndpoint: "paperclip-local",
        openClawSyncGeneratedAt: "2026-02-10T18:00:00.000Z",
        openClawSyncTargetRoot: "C:\\CTO Projects\\AI_HELL_MARY",
        openClawSyncManifestPath: "C:\\CTO Projects\\AI_HELL_MARY\\docs\\generated\\mission-control\\sync-manifest.json",
        openClawSyncStaleHours: 144,
      },
      posWorker: null,
      paperclip: DEFAULT_PAPERCLIP,
      governance: DEFAULT_GOVERNANCE,
      budgetGovernor: DEFAULT_BUDGET,
      customerMemory: DEFAULT_CUSTOMER_MEMORY,
      productCatalog: DEFAULT_PRODUCT_CATALOG,
      adOps: DEFAULT_AD_OPS,
      mobileOps: DEFAULT_MOBILE_OPS,
      reliability: DEFAULT_RELIABILITY,
    });

    const smAuto = snapshot.services.find((service) => service.id === "smauto_mcp");
    const leadOps = snapshot.services.find((service) => service.id === "leadops_mcp");
    const paperclip = snapshot.services.find((service) => service.id === "paperclip_system");
    const openClawSync = snapshot.services.find((service) => service.id === "openclaw_sync");
    expect(smAuto?.state).toBe("degraded");
    expect(leadOps?.state).toBe("degraded");
    expect(paperclip?.state).toBe("degraded");
    expect(openClawSync?.state).toBe("degraded");
    expect(String(smAuto?.detail || "")).toContain("invalid");
    expect(String(leadOps?.detail || "")).toContain("invalid");
    expect(String(paperclip?.detail || "")).toContain("invalid");
    expect(String(openClawSync?.detail || "")).toContain("last sync");
  });

  it("marks revenue KPI degraded when a critical outcome gate fails", () => {
    const snapshot = buildControlPlaneSnapshot({
      nowIso: "2026-03-02T18:00:00.000Z",
      spaces: {},
      secretStatus: {
        ...ALL_MISSING,
        openaiKey: "secret",
      },
      google: { connected: false, drive: false, gmail: false, calendar: false },
      quota: {
        orgId: "org-1",
        windowKey: "2026-03-02",
        runsUsed: 0,
        leadsUsed: 0,
        activeRuns: 0,
        maxRunsPerDay: 80,
        maxLeadsPerDay: 1200,
        maxActiveRuns: 3,
        runsRemaining: 80,
        leadsRemaining: 1200,
        utilization: { runsPct: 0, leadsPct: 0 },
      },
      alerts: [],
      telemetryGroups: [],
      driveSummary: { lastRunAt: null, staleDays: null, lastResultCount: 0 },
      skillHealth: {
        knowledgePackPresent: true,
        hasAgentTopology: true,
        hasKnowledgeIngestionPolicy: true,
        hasVoiceOpsPolicy: true,
      },
      externalTools: NO_EXTERNAL_TOOLS,
      posWorker: null,
      weeklyKpi: {
        weekStartDate: "2026-03-02",
        weekEndDate: "2026-03-08",
        generatedAt: "2026-03-02T17:55:00.000Z",
        leadsSourced: 6,
        closeRatePct: 0,
        depositsCollected: 0,
        dealsWon: 0,
        pipelineValueUsd: 1200,
        decisionSummary: { scale: 0, fix: 1, kill: 0, watch: 1 },
        outcomeGates: {
          summary: { passCount: 0, warnCount: 2, failCount: 3, passOrWarnCount: 2 },
          criticalGateFailures: ["revenue"],
        },
      },
      paperclip: DEFAULT_PAPERCLIP,
      governance: DEFAULT_GOVERNANCE,
      budgetGovernor: DEFAULT_BUDGET,
      customerMemory: DEFAULT_CUSTOMER_MEMORY,
      productCatalog: DEFAULT_PRODUCT_CATALOG,
      adOps: DEFAULT_AD_OPS,
      mobileOps: DEFAULT_MOBILE_OPS,
      reliability: DEFAULT_RELIABILITY,
    });

    expect(snapshot.operations.revenueKpi.state).toBe("degraded");
    expect(snapshot.operations.revenueKpi.outcomeGates.criticalGateFailures).toContain("revenue");
  });

  it("marks revenue KPI operational when report is fresh and critical outcome gates pass", () => {
    const snapshot = buildControlPlaneSnapshot({
      nowIso: "2026-03-02T18:00:00.000Z",
      spaces: {},
      secretStatus: {
        ...ALL_MISSING,
        openaiKey: "secret",
      },
      google: { connected: false, drive: false, gmail: false, calendar: false },
      quota: {
        orgId: "org-1",
        windowKey: "2026-03-02",
        runsUsed: 0,
        leadsUsed: 0,
        activeRuns: 0,
        maxRunsPerDay: 80,
        maxLeadsPerDay: 1200,
        maxActiveRuns: 3,
        runsRemaining: 80,
        leadsRemaining: 1200,
        utilization: { runsPct: 0, leadsPct: 0 },
      },
      alerts: [],
      telemetryGroups: [],
      driveSummary: { lastRunAt: null, staleDays: null, lastResultCount: 0 },
      skillHealth: {
        knowledgePackPresent: true,
        hasAgentTopology: true,
        hasKnowledgeIngestionPolicy: true,
        hasVoiceOpsPolicy: true,
      },
      externalTools: NO_EXTERNAL_TOOLS,
      posWorker: null,
      weeklyKpi: {
        weekStartDate: "2026-03-02",
        weekEndDate: "2026-03-08",
        generatedAt: "2026-03-02T17:55:00.000Z",
        leadsSourced: 12,
        closeRatePct: 12,
        depositsCollected: 1,
        dealsWon: 1,
        pipelineValueUsd: 5200,
        decisionSummary: { scale: 0, fix: 0, kill: 2, watch: 0 },
        outcomeGates: {
          summary: { passCount: 3, warnCount: 2, failCount: 0, passOrWarnCount: 5 },
          criticalGateFailures: [],
        },
      },
      paperclip: DEFAULT_PAPERCLIP,
      governance: DEFAULT_GOVERNANCE,
      budgetGovernor: DEFAULT_BUDGET,
      customerMemory: DEFAULT_CUSTOMER_MEMORY,
      productCatalog: DEFAULT_PRODUCT_CATALOG,
      adOps: DEFAULT_AD_OPS,
      mobileOps: DEFAULT_MOBILE_OPS,
      reliability: DEFAULT_RELIABILITY,
    });

    expect(snapshot.operations.revenueKpi.state).toBe("operational");
    expect(snapshot.operations.revenueKpi.outcomeGates.passOrWarnCount).toBe(5);
  });
});
