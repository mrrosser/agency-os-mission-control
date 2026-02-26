import { describe, expect, it } from "vitest";
import { buildControlPlaneSnapshot } from "@/lib/agent-control-plane";
import type { SecretStatus } from "@/lib/api/secrets";

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
      externalTools: {
        smAutoEndpoint: null,
        leadOpsEndpoint: null,
      },
      posWorker: null,
    });

    expect(snapshot.summary.health).toBe("offline");
    expect(snapshot.summary.activeAgents).toBe(0);
    expect(snapshot.services.find((service) => service.id === "openai_brain")?.state).toBe("offline");
    expect(snapshot.services.find((service) => service.id === "smauto_mcp")?.state).toBe("degraded");
    expect(snapshot.services.find((service) => service.id === "leadops_mcp")?.state).toBe("degraded");
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
    expect(snapshot.services.find((service) => service.id === "square_pos")?.state).toBe("operational");
    expect(snapshot.operations.queueHealth.state).toBe("operational");
    expect(snapshot.operations.socialDispatch.state).toBe("operational");
    expect(snapshot.operations.revenueKpi.state).toBe("operational");
    expect(snapshot.operations.revenueKpi.decisionSummary.scale).toBe(1);
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
      },
      posWorker: null,
    });

    const smAuto = snapshot.services.find((service) => service.id === "smauto_mcp");
    const leadOps = snapshot.services.find((service) => service.id === "leadops_mcp");
    expect(smAuto?.state).toBe("degraded");
    expect(leadOps?.state).toBe("degraded");
    expect(String(smAuto?.detail || "")).toContain("invalid");
    expect(String(leadOps?.detail || "")).toContain("invalid");
  });
});
