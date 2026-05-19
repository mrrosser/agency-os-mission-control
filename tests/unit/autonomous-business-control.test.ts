import { describe, expect, it } from "vitest";
import {
  buildAutonomousBusinessSnapshot,
  buildBudgetGovernorSnapshot,
  buildGovernanceSnapshot,
} from "@/lib/control-plane/autonomous-business";

describe("autonomous business control builders", () => {
  it("marks budget governor offline when hard-stop is active", () => {
    const snapshot = buildBudgetGovernorSnapshot({
      mode: "hard-stop",
      monthBudgetUsd: 100,
      projectedMonthEndUsd: 220,
      globalKillSwitchEnabled: false,
      providers: [
        {
          providerId: "openai",
          label: "OpenAI",
          actualUsd: 120,
          estimatedUsd: 0,
          unreconciledUsd: 0,
          hardLimitUsd: 100,
          writeEnabled: true,
        },
      ],
    });

    expect(snapshot.state).toBe("offline");
    expect(snapshot.hardStopActive).toBe(true);
    expect(snapshot.blockedProviders).toContain("openai");
  });

  it("marks governance degraded when kill switches are active", () => {
    const snapshot = buildGovernanceSnapshot({
      globalKillSwitchEnabled: false,
      providerKillSwitches: ["meta_ads"],
      businessKillSwitches: ["rt_solutions"],
      approvalRequiredClasses: [
        "public_facing",
        "financial_or_credentialed",
        "spend_bearing",
      ],
    });

    expect(snapshot.state).toBe("degraded");
    expect(snapshot.failClosed).toBe(true);
    expect(snapshot.providerKillSwitches).toContain("meta_ads");
    expect(snapshot.businessKillSwitches).toContain("rt_solutions");
  });

  it("builds a mobile-ready autonomous business snapshot", () => {
    const snapshot = buildAutonomousBusinessSnapshot({
      paperclip: {
        state: "operational",
        configured: true,
        reachable: true,
        canProxyActions: true,
        baseUrl: "https://paperclip.example/system",
        sourceOfTruth: "paperclip",
        companyCount: 2,
        agentCount: 8,
        activeRunCount: 3,
        detail: "Paperclip reachable.",
        capabilities: {
          lifecycleActions: true,
          heartbeats: true,
          budgets: true,
          audit: true,
          mobile: true,
        },
      },
      governance: {
        globalKillSwitchEnabled: false,
        providerKillSwitches: [],
        businessKillSwitches: [],
        approvalRequiredClasses: [
          "public_facing",
          "financial_or_credentialed",
          "spend_bearing",
        ],
      },
      budgetGovernor: {
        mode: "hard-stop",
        monthBudgetUsd: 1000,
        projectedMonthEndUsd: 420,
        globalKillSwitchEnabled: false,
        providers: [
          {
            providerId: "openai",
            label: "OpenAI",
            actualUsd: 180,
            estimatedUsd: 0,
            unreconciledUsd: 0,
            hardLimitUsd: 400,
            writeEnabled: true,
          },
        ],
      },
      customerMemory: {
        sourceOfTruth: "paperclip",
        knownContacts: 42,
        recentTimelineEvents: 16,
        lastTimelineAt: "2026-04-06T16:00:00.000Z",
        emailReady: true,
        smsReady: true,
        voiceReady: true,
        calendarReady: true,
        socialReady: true,
        posReady: true,
        paidAdsReady: true,
        duplicateProtection: true,
        dncProtection: true,
      },
      productCatalog: {
        catalogSource: "mission-control.offer-definitions",
        businessUnitCount: 3,
        activeOfferCount: 9,
        approvalGated: true,
      },
      adOps: {
        metaAdsConfigured: true,
        googleAdsConfigured: true,
        metaAdsWriteEnabled: true,
        googleAdsWriteEnabled: true,
        approvalGated: true,
      },
      profitAttribution: {
        pipelineValueUsd: 12000,
        leadsSourced: 24,
        depositsCollected: 4,
        dealsWon: 2,
        monthToDateSpendUsd: 220,
      },
      mobileOps: {
        deepLinkBaseUrl: "https://leadflow-review.web.app",
        googleSpaceReady: true,
        lifecycleActionsEnabled: true,
      },
      reliability: {
        targetSloPct: 99.9,
        primaryRegion: "us-central1",
        failoverRegion: "us-east1",
        healthEndpointEnabled: true,
        queueHealth: "operational",
      },
    });

    expect(snapshot.paperclip.state).toBe("operational");
    expect(snapshot.customerMemory.state).toBe("operational");
    expect(snapshot.adOps.state).toBe("operational");
    expect(snapshot.mobileOps.state).toBe("operational");
    expect(snapshot.reliability.state).toBe("operational");
    expect(snapshot.profitAttribution.blendedRoas).toBeGreaterThan(10);
  });
});
